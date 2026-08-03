#!/usr/bin/env bash
# Puts back the version that was running before the last update.sh.
#
# update.sh keeps one previous copy under /opt/motor-city/previous. This restores it
# and restarts the service. Running it twice does not step further back.
#
# Usage:  sudo bash rollback.sh

set -euo pipefail

APP_USER="motorcity"
APP_DIR="/opt/motor-city"
BACKUP_DIR="$APP_DIR/previous"
APP_PORT="4000"

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ -d $BACKUP_DIR/dist-server ]] || { echo "No previous version kept at $BACKUP_DIR." >&2; exit 1; }

echo "== Restoring the previous version"
for item in dist dist-server package.json package-lock.json node_modules; do
  if [[ -e $BACKUP_DIR/$item ]]; then
    rm -rf "${APP_DIR:?}/$item"
    cp -a "$BACKUP_DIR/$item" "$APP_DIR/"
  fi
done
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/dist" "$APP_DIR/dist-server"

systemctl restart motor-city

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
    echo "Previous version is back up."
    exit 0
  fi
  sleep 1
done

echo "The restored version is still not answering /api/health." >&2
systemctl --no-pager --lines=30 status motor-city >&2 || true
exit 1
