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

APP_USER="${MOTOR_CITY_APP_USER:-motorcity}"
APP_DIR="${MOTOR_CITY_APP_DIR:-/opt/motor-city}"
SRC_DIR="$APP_DIR/src"
NODE_BIN="$APP_DIR/node/bin"
BACKUP_DIR="$APP_DIR/previous"
STAGE_DIR="$APP_DIR/next"
DEPLOY_KEY="$APP_DIR/.ssh/deploy_key"
ENV_FILE="${MOTOR_CITY_ENV_FILE:-/etc/motor-city.env}"
SERVICE_FILE="${MOTOR_CITY_SERVICE_FILE:-/etc/systemd/system/motor-city.service}"
UPDATE_CONTROL="${MOTOR_CITY_UPDATE_CONTROL:-/usr/local/sbin/motor-city-update}"
ROLLBACK_CONTROL="${MOTOR_CITY_ROLLBACK_CONTROL:-/usr/local/sbin/motor-city-rollback}"
DEPLOY_LOCK="${MOTOR_CITY_DEPLOY_LOCK:-/run/lock/motor-city-deploy.lock}"
REPO_SSH="${MOTOR_CITY_REPO_SSH:-git@github.com:23rli/motor-city-supply-game.git}"
APP_PORT="${MOTOR_CITY_APP_PORT:-4000}"
REF="${1:-}"

log() { printf '\n== %s\n' "$1"; }
die() { echo "$1" >&2; exit 1; }

if [[ $EUID -ne 0 && -z ${MOTOR_CITY_APP_DIR:-} ]]; then
  die "Run with sudo."
fi
[[ -x $NODE_BIN/node ]] || die "No private Node runtime at $NODE_BIN. Run install.sh first."
[[ -f $ENV_FILE ]] || die "No $ENV_FILE. Run install.sh first."
grep -Eq '^MIGRATE_ON_START=true[[:space:]]*$' "$ENV_FILE" \
  || die "MIGRATE_ON_START=true is required in $ENV_FILE. Nothing changed."
grep -Eq '^NODE_ENV=production[[:space:]]*$' "$ENV_FILE" \
  || die "NODE_ENV=production is required in $ENV_FILE. Nothing changed."
command -v git >/dev/null 2>&1 || die "git is not installed. Install it, then re-run."
command -v systemd-analyze >/dev/null 2>&1 \
  || die "systemd-analyze is required to validate the service unit. Nothing changed."
command -v flock >/dev/null 2>&1 || die "flock is required to serialize deployments. Nothing changed."
exec 9>"$DEPLOY_LOCK"
flock -n 9 || die "Another Motor City update or rollback is already running. Nothing changed."

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

release_healthy() {
  curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:$APP_PORT/" 2>/dev/null \
      | grep -q 'id="root"'
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
[[ -f $SRC_DIR/dist-server/optimizer-worker.js ]] \
  || die "Build produced no dist-server/optimizer-worker.js."
[[ -f $SRC_DIR/dist/index.html ]] || die "Build produced no dist/index.html."
CANDIDATE_SERVICE="$SRC_DIR/deploy/motor-city.service"
[[ -f $CANDIDATE_SERVICE ]] || die "Release has no deploy/motor-city.service."
systemd-analyze verify "$CANDIDATE_SERVICE"

restore() {
  set +e
  echo "  putting the previous version back" >&2
  systemctl stop motor-city
  for item in dist dist-server package.json package-lock.json node_modules; do
    if [[ -e $BACKUP_DIR/$item ]]; then
      rm -rf "${APP_DIR:?}/$item"
      cp -a "$BACKUP_DIR/$item" "$APP_DIR/"
    fi
  done
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR/dist" "$APP_DIR/dist-server" \
    "$APP_DIR/node_modules" "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
  if [[ -f $BACKUP_DIR/motor-city.service ]]; then
    install -o root -g root -m 644 "$BACKUP_DIR/motor-city.service" "$SERVICE_FILE"
    systemctl daemon-reload
  fi
  systemctl start motor-city
  for _ in $(seq 1 20); do
    if release_healthy; then
      echo "  previous version passed its health check" >&2
      return 0
    fi
    sleep 1
  done
  echo "The previous version was restored but did not pass /api/health." >&2
  return 1
}

ROLLBACK_READY=0
on_error() {
  local status=$?
  trap - ERR INT TERM
  if (( ROLLBACK_READY == 1 )); then
    echo "Deployment failed after the previous version was secured." >&2
    restore
  fi
  rm -rf "$STAGE_DIR"
  rm -f "${UPDATE_CONTROL}.next" "${ROLLBACK_CONTROL}.next"
  exit "$status"
}
trap on_error ERR INT TERM

log "Staging the complete runtime before touching the live version"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
for item in dist dist-server package.json package-lock.json; do
  cp -a "$SRC_DIR/$item" "$STAGE_DIR/"
done
chown -R "$APP_USER":"$APP_USER" "$STAGE_DIR"
as_app "$NODE_BIN/npm" --prefix "$STAGE_DIR" ci --omit=dev --no-audit --no-fund

for item in dist dist-server package.json package-lock.json node_modules; do
  [[ -e $APP_DIR/$item ]] || die "The current release is incomplete: missing $APP_DIR/$item. Nothing changed."
done
[[ -f $SERVICE_FILE ]] || die "The current release is missing $SERVICE_FILE. Nothing changed."

log "Securing the current release for rollback"
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -a "$SERVICE_FILE" "$BACKUP_DIR/motor-city.service"
ROLLBACK_READY=1

log "Swapping releases"
systemctl stop motor-city
for item in dist dist-server package.json package-lock.json node_modules; do
  mv "$APP_DIR/$item" "$BACKUP_DIR/"
  mv "$STAGE_DIR/$item" "$APP_DIR/"
done
rm -rf "$STAGE_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/dist" "$APP_DIR/dist-server" \
  "$APP_DIR/node_modules" "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
install -o root -g root -m 644 "$CANDIDATE_SERVICE" "$SERVICE_FILE"
systemctl daemon-reload

log "Restarting"
systemctl enable motor-city
systemctl start motor-city

HEALTHY=0
for _ in $(seq 1 20); do
  if release_healthy; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if (( HEALTHY == 0 )); then
  echo "" >&2
  echo "The new version did not answer /api/health within 20s." >&2
  systemctl --no-pager --lines=30 status motor-city >&2 || true
  false
fi

log "Refreshing deployment controls"
install -o root -g root -m 755 "$SRC_DIR/deploy/update.sh" "${UPDATE_CONTROL}.next"
install -o root -g root -m 755 "$SRC_DIR/deploy/rollback.sh" "${ROLLBACK_CONTROL}.next"
mv -f "${UPDATE_CONTROL}.next" "$UPDATE_CONTROL"
mv -f "${ROLLBACK_CONTROL}.next" "$ROLLBACK_CONTROL"

ROLLBACK_READY=0
trap - ERR INT TERM

# Caddy is deliberately left alone: its configuration has not changed and restarting it
# would drop TLS for a moment for no reason.

SITE="$(awk '/^[a-z0-9.-]+ \{/ { print $1; exit }' /etc/caddy/Caddyfile 2>/dev/null || true)"

cat <<EOF

Shipped $REF at $COMMIT.

  https://${SITE:-your-hostname}  -> this game
  http://${SITE:-your-hostname}   -> the current game, still untouched

Logs:      sudo journalctl -u motor-city -f
Roll back: sudo /usr/local/sbin/motor-city-rollback
EOF
