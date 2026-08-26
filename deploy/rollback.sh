#!/usr/bin/env bash
# Puts back the version that was running before the last update.sh.
#
# update.sh keeps one previous copy under /opt/motor-city/previous. This restores it
# and restarts the service. Running it twice does not step further back.
#
# Usage:  sudo bash rollback.sh

set -euo pipefail

APP_USER="${MOTOR_CITY_APP_USER:-motorcity}"
APP_DIR="${MOTOR_CITY_APP_DIR:-/opt/motor-city}"
BACKUP_DIR="$APP_DIR/previous"
STAGE_DIR="$APP_DIR/rollback-next"
FAILED_DIR="$APP_DIR/rollback-failed"
APP_PORT="${MOTOR_CITY_APP_PORT:-4000}"
ENV_FILE="${MOTOR_CITY_ENV_FILE:-/etc/motor-city.env}"

if [[ $EUID -ne 0 && -z ${MOTOR_CITY_APP_DIR:-} ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
for item in dist dist-server package.json package-lock.json node_modules; do
  [[ -e $BACKUP_DIR/$item ]] || { echo "Previous release is missing $item." >&2; exit 1; }
done
grep -Eq '^NODE_ENV=production[[:space:]]*$' "$ENV_FILE" \
  || { echo "NODE_ENV=production is required in $ENV_FILE." >&2; exit 1; }

release_healthy() {
  curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:$APP_PORT/" 2>/dev/null \
      | grep -q 'id="root"'
}

FREE_MB="$(df -Pm "$APP_DIR" | awk 'NR==2 {print $4}')"
if (( FREE_MB < 1500 )); then
  echo "Only ${FREE_MB}MB free. A staged rollback needs roughly 1.5GB. Nothing changed." >&2
  exit 1
fi

echo "== Staging the previous version"
rm -rf "$STAGE_DIR" "$FAILED_DIR"
mkdir -p "$STAGE_DIR"
for item in dist dist-server package.json package-lock.json node_modules; do
  cp -a "$BACKUP_DIR/$item" "$STAGE_DIR/"
done
chown -R "$APP_USER":"$APP_USER" "$STAGE_DIR"

SWAP_STARTED=0
restore_current() {
  set +e
  systemctl stop motor-city
  for item in dist dist-server package.json package-lock.json node_modules; do
    rm -rf "${APP_DIR:?}/$item"
    [[ -e $FAILED_DIR/$item ]] && mv "$FAILED_DIR/$item" "$APP_DIR/"
  done
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR/dist" "$APP_DIR/dist-server" \
    "$APP_DIR/node_modules" "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
  systemctl start motor-city
}

on_error() {
  local status=$?
  trap - ERR INT TERM
  if (( SWAP_STARTED == 1 )); then
    echo "Rollback failed; restoring the release that was running before it." >&2
    restore_current
  fi
  rm -rf "$STAGE_DIR" "$FAILED_DIR"
  exit "$status"
}
trap on_error ERR INT TERM

echo "== Restoring the previous version"
systemctl stop motor-city
mkdir -p "$FAILED_DIR"
SWAP_STARTED=1
for item in dist dist-server package.json package-lock.json node_modules; do
  mv "$APP_DIR/$item" "$FAILED_DIR/"
  mv "$STAGE_DIR/$item" "$APP_DIR/"
done
rm -rf "$STAGE_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/dist" "$APP_DIR/dist-server" \
  "$APP_DIR/node_modules" "$APP_DIR/package.json" "$APP_DIR/package-lock.json"

systemctl enable motor-city
systemctl start motor-city

for _ in $(seq 1 20); do
  if release_healthy; then
    SWAP_STARTED=0
    trap - ERR INT TERM
    rm -rf "$FAILED_DIR"
    echo "Previous version is back up."
    exit 0
  fi
  sleep 1
done

echo "The restored version is still not answering /api/health." >&2
systemctl --no-pager --lines=30 status motor-city >&2 || true
false
