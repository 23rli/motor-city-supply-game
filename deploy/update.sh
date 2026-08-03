#!/usr/bin/env bash
# Ships a new version of the game onto a box that install.sh has already prepared.
#
# Builds first and only swaps once the build succeeds, so a broken commit cannot take
# the site down. If the new version fails its health check the previous one is put back
# and the script exits non-zero.
#
# The current game is never touched: nginx keeps :80, MariaDB keeps :3306, and the
# system Node package is ignored in favour of the private runtime under /opt/motor-city.
#
# Usage:  sudo bash update.sh [git-ref]
# Defaults to the branch already checked out, or main on a first run.

set -euo pipefail

APP_USER="motorcity"
APP_DIR="/opt/motor-city"
SRC_DIR="$APP_DIR/src"
NODE_BIN="$APP_DIR/node/bin"
BACKUP_DIR="$APP_DIR/previous"
DEPLOY_KEY="$APP_DIR/.ssh/deploy_key"
REPO_SSH="git@github.com:23rli/motor-city-supply-game.git"
APP_PORT="4000"
REF="${1:-}"

log() { printf '\n== %s\n' "$1"; }
die() { echo "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo."
[[ -x $NODE_BIN/node ]] || die "No private Node runtime at $NODE_BIN. Run install.sh first."
[[ -f /etc/motor-city.env ]] || die "No /etc/motor-city.env. Run install.sh first."
command -v git >/dev/null 2>&1 || die "git is not installed. Install it, then re-run."

FREE_MB="$(df -Pm "$APP_DIR" | awk 'NR==2 {print $4}')"
if (( FREE_MB < 1500 )); then
  die "Only ${FREE_MB}MB free. A build plus a rollback copy needs roughly 1.5GB. Nothing changed."
fi

# A read-only deploy key lets the repository stay private. Without one we fall back to
# whatever remote the existing checkout already has.
if [[ -f $DEPLOY_KEY ]]; then
  chmod 600 "$DEPLOY_KEY"
  chown "$APP_USER":"$APP_USER" "$DEPLOY_KEY"
  GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

# sudo resets PATH from secure_path on most distributions, which would hide the private
# Node from npm's shebang. Going through env sets it after sudo has finished sanitising.
as_app() {
  local -a envs=("PATH=$NODE_BIN:/usr/local/bin:/usr/bin:/bin" "HOME=$APP_DIR")
  if [[ -n ${GIT_SSH_COMMAND:-} ]]; then
    envs+=("GIT_SSH_COMMAND=$GIT_SSH_COMMAND")
  fi
  sudo -u "$APP_USER" env "${envs[@]}" "$@"
}

log "Fetching source"
if [[ -d $SRC_DIR/.git ]]; then
  as_app git -C "$SRC_DIR" fetch --prune origin
else
  [[ -f $DEPLOY_KEY ]] || die "No checkout at $SRC_DIR and no deploy key at $DEPLOY_KEY."
  mkdir -p "$SRC_DIR"
  chown "$APP_USER":"$APP_USER" "$SRC_DIR"
  as_app git clone -q "$REPO_SSH" "$SRC_DIR"
fi

if [[ -z $REF ]]; then
  REF="$(as_app git -C "$SRC_DIR" symbolic-ref --quiet --short HEAD || echo main)"
fi
as_app git -C "$SRC_DIR" checkout -q --detach "origin/$REF" 2>/dev/null \
  || as_app git -C "$SRC_DIR" checkout -q --detach "$REF"
COMMIT="$(as_app git -C "$SRC_DIR" rev-parse --short HEAD)"
echo "  building $REF at $COMMIT"

log "Building (the running version keeps serving throughout)"
as_app "$NODE_BIN/npm" --prefix "$SRC_DIR" ci --no-audit --no-fund
as_app "$NODE_BIN/npm" --prefix "$SRC_DIR" run build
[[ -f $SRC_DIR/dist-server/index.js ]] || die "Build produced no dist-server/index.js."
[[ -f $SRC_DIR/dist/index.html ]] || die "Build produced no dist/index.html."

log "Keeping the current version so it can be put back"
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
for item in dist dist-server package.json package-lock.json node_modules; do
  [[ -e $APP_DIR/$item ]] && cp -a "$APP_DIR/$item" "$BACKUP_DIR/"
done

restore() {
  echo "  putting the previous version back" >&2
  for item in dist dist-server package.json package-lock.json node_modules; do
    if [[ -e $BACKUP_DIR/$item ]]; then
      rm -rf "${APP_DIR:?}/$item"
      cp -a "$BACKUP_DIR/$item" "$APP_DIR/"
    fi
  done
  systemctl restart motor-city || true
}

log "Swapping in the new version"
for item in dist dist-server package.json package-lock.json; do
  rm -rf "${APP_DIR:?}/$item"
  cp -a "$SRC_DIR/$item" "$APP_DIR/"
done
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/dist" "$APP_DIR/dist-server" \
  "$APP_DIR/package.json" "$APP_DIR/package-lock.json"

# Runtime dependencies only. Schema changes apply themselves on start.
as_app "$NODE_BIN/npm" --prefix "$APP_DIR" ci --omit=dev --no-audit --no-fund

log "Restarting"
systemctl restart motor-city

HEALTHY=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if (( HEALTHY == 0 )); then
  echo "" >&2
  echo "The new version did not answer /api/health within 20s." >&2
  systemctl --no-pager --lines=30 status motor-city >&2 || true
  restore
  die "Rolled back to the previous version. Nothing shipped."
fi

# Caddy is deliberately left alone: its configuration has not changed and restarting it
# would drop TLS for a moment for no reason.

SITE="$(awk '/^[a-z0-9.-]+ \{/ { print $1; exit }' /etc/caddy/Caddyfile 2>/dev/null || true)"

cat <<EOF

Shipped $REF at $COMMIT.

  https://${SITE:-your-hostname}  -> this game
  http://${SITE:-your-hostname}   -> the current game, still untouched

Logs:      sudo journalctl -u motor-city -f
Roll back: sudo bash $SRC_DIR/deploy/rollback.sh
EOF
