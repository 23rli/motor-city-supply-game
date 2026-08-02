#!/usr/bin/env bash
# Installs the new Motor City stack ALONGSIDE the existing game.
#
# Deliberately touches nothing the current game uses:
#   nginx keeps :80, MariaDB keeps :3306, /home/Admin/PullingSupplyGame is never read or written,
#   and the system Node.js package is never added, upgraded or removed - this stack brings its own
#   private runtime so the Node the current game runs on cannot shift underneath it.
# The new stack takes :443 (Caddy), :4000 (app, loopback only) and PostgreSQL on :5432.
#
# Usage:  sudo bash install.sh <public-hostname> <admin-email>
# Re-running is safe; every step checks before it acts and the database password is preserved.

set -euo pipefail

HOSTNAME_ARG="${1:?usage: install.sh <public-hostname> <admin-email>}"
EMAIL_ARG="${2:?usage: install.sh <public-hostname> <admin-email>}"

APP_USER="motorcity"
APP_DIR="/opt/motor-city"
NODE_DIR="/opt/motor-city/node"
ENV_FILE="/etc/motor-city.env"
DB_NAME="motor_city"
DB_USER="motor_city"
APP_PORT="4000"

log() { printf '\n== %s\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  PKG="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG="dnf"
else
  echo "Unsupported package manager: expected apt-get or dnf." >&2
  exit 1
fi

log "Confirming we are not about to disturb the live game"
for port in 80 3306; do
  if ss -ltn "sport = :$port" | grep -q LISTEN; then
    echo "  :$port in use (expected - the current game). Leaving it alone."
  fi
done
if ss -ltn "sport = :443" | grep -q LISTEN; then
  echo "  :443 is already in use. Stop here and check what owns it." >&2
  exit 1
fi

log "Installing PostgreSQL and Caddy"
if [[ $PKG == apt ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq postgresql curl xz-utils ca-certificates \
    debian-keyring debian-archive-keyring apt-transport-https gnupg
  if ! command -v caddy >/dev/null 2>&1; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
      | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy
    # The package ships a demo site on :80. Stop it before it can race nginx.
    systemctl stop caddy || true
  fi
else
  dnf install -y -q postgresql-server caddy tar xz
  [[ -d /var/lib/pgsql/data/base ]] || postgresql-setup --initdb
  systemctl stop caddy || true
fi

systemctl enable --now postgresql

log "Creating the application user and directory"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

log "Installing a private Node.js runtime (the system package is left untouched)"
case "$(uname -m)" in
  x86_64) NODE_ARCH="linux-x64" ;;
  aarch64 | arm64) NODE_ARCH="linux-arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
if [[ ! -x $NODE_DIR/bin/node ]]; then
  NODE_BASE="https://nodejs.org/dist/latest-v22.x"
  WORK="$(mktemp -d)"
  curl -fsSL "$NODE_BASE/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
  TARBALL="$(grep -o "node-v22\.[0-9.]*-$NODE_ARCH\.tar\.xz" "$WORK/SHASUMS256.txt" | head -1)"
  [[ -n $TARBALL ]] || { echo "Could not determine the Node.js tarball name." >&2; exit 1; }
  curl -fsSL "$NODE_BASE/$TARBALL" -o "$WORK/$TARBALL"
  # Refuse to install a runtime that does not match the published checksum.
  (cd "$WORK" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$NODE_DIR"
  tar -xJf "$WORK/$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$WORK"
fi
"$NODE_DIR/bin/node" -v
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

log "Creating the database"
# Preserve any existing password so re-running cannot orphan the running service.
DB_PASSWORD=""
if [[ -f $ENV_FILE ]]; then
  DB_PASSWORD="$(sed -n 's|^DATABASE_URL=postgres://[^:]*:\([^@]*\)@.*|\1|p' "$ENV_FILE")"
fi
if [[ -z $DB_PASSWORD ]]; then
  DB_PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
fi

# The password goes over stdin as a quoted psql variable, never on a command line where ps could see it.
if [[ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")" == "1" ]]; then
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v pw="$DB_PASSWORD" <<SQL
ALTER ROLE $DB_USER WITH LOGIN PASSWORD :'pw';
SQL
else
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v pw="$DB_PASSWORD" <<SQL
CREATE ROLE $DB_USER WITH LOGIN PASSWORD :'pw';
SQL
fi
if [[ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" != "1" ]]; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

log "Writing $ENV_FILE (root-readable only)"
umask 077
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$APP_PORT
HOST=127.0.0.1
STATIC_ROOT=$APP_DIR/dist
DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME
MIGRATE_ON_START=true
EOF
chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"
umask 022

log "Installing the service"
HERE="$(cd "$(dirname "$0")" && pwd)"
install -m 644 "$HERE/motor-city.service" /etc/systemd/system/motor-city.service
systemctl daemon-reload

log "Configuring TLS on :443 only, leaving :80 to the current game"
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy 2>/dev/null || true
sed -e "s/__HOSTNAME__/$HOSTNAME_ARG/g" -e "s/__EMAIL__/$EMAIL_ARG/g" \
  "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy

cat <<EOF

Prepared. Nothing is serving the new game yet.

The current game is untouched: nginx still owns :80 and the system Node package was not modified.

With dist/, dist-server/, package.json and package-lock.json copied into $APP_DIR:
  cd $APP_DIR
  sudo -u $APP_USER $NODE_DIR/bin/npm ci --omit=dev
  sudo systemctl start motor-city && sudo systemctl restart caddy
  curl -sS localhost:$APP_PORT/api/health

  http://$HOSTNAME_ARG   -> the current game
  https://$HOSTNAME_ARG  -> the new game
EOF
