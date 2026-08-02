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

FREE_MB="$(df -Pm / | awk 'NR==2 {print $4}')"
if (( FREE_MB < 3000 )); then
  echo "  Only ${FREE_MB}MB free on /. This needs roughly 3GB. Stopping before anything changes." >&2
  exit 1
fi
echo "  ${FREE_MB}MB free on /, :443 is unused. Safe to continue."

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
  # Amazon Linux 2023 has no "caddy" package and only versioned PostgreSQL.
  # curl is deliberately absent here: curl-minimal already provides it and the two conflict.
  dnf install -y -q tar xz gzip ca-certificates
  dnf install -y -q postgresql16-server postgresql16 \
    || dnf install -y -q postgresql15-server postgresql15
  [[ -d /var/lib/pgsql/data/base ]] || postgresql-setup --initdb
  if ! command -v caddy >/dev/null 2>&1; then
    log "Installing Caddy from the official static release"
    CADDY_VER="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest \
      | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)"
    [[ -n $CADDY_VER ]] || { echo "Could not determine the Caddy version." >&2; exit 1; }
    case "$(uname -m)" in
      x86_64) CADDY_ARCH="amd64" ;;
      aarch64 | arm64) CADDY_ARCH="arm64" ;;
      *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    CWORK="$(mktemp -d)"
    CBASE="https://github.com/caddyserver/caddy/releases/download/v$CADDY_VER"
    CFILE="caddy_${CADDY_VER}_linux_${CADDY_ARCH}.tar.gz"
    echo "  version $CADDY_VER, asset $CFILE"
    curl -fsSL "$CBASE/$CFILE" -o "$CWORK/$CFILE"
    curl -fsSL "$CBASE/caddy_${CADDY_VER}_checksums.txt" -o "$CWORK/checksums.txt"
    # Caddy publishes SHA-512 in a file named "checksums.txt", so verify with sha512sum.
    EXPECTED="$(awk -v f="$CFILE" '$2 == f || $2 == "*" f { print $1 }' "$CWORK/checksums.txt" | head -1)"
    if [[ -z $EXPECTED ]]; then
      echo "  No checksum listed for $CFILE. The checksums file starts:" >&2
      head -5 "$CWORK/checksums.txt" >&2
      exit 1
    fi
    ACTUAL="$(sha512sum "$CWORK/$CFILE" | awk '{ print $1 }')"
    if [[ $EXPECTED != "$ACTUAL" ]]; then
      echo "  Checksum mismatch for $CFILE - refusing to install." >&2
      exit 1
    fi
    tar -xzf "$CWORK/$CFILE" -C "$CWORK" caddy
    install -m 755 "$CWORK/caddy" /usr/local/bin/caddy
    rm -rf "$CWORK"
    id -u caddy >/dev/null 2>&1 \
      || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
    mkdir -p /etc/caddy
    cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-abnormal
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
  fi
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
  # Node publishes SHA-256 here; match on fields so spacing cannot break it.
  NODE_EXPECTED="$(awk -v f="$TARBALL" '$2 == f || $2 == "*" f { print $1 }' "$WORK/SHASUMS256.txt" | head -1)"
  if [[ -z $NODE_EXPECTED ]]; then
    echo "No checksum listed for $TARBALL." >&2
    exit 1
  fi
  NODE_ACTUAL="$(sha256sum "$WORK/$TARBALL" | awk '{ print $1 }')"
  if [[ $NODE_EXPECTED != "$NODE_ACTUAL" ]]; then
    echo "Checksum mismatch for $TARBALL - refusing to install." >&2
    exit 1
  fi
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

# RHEL-family defaults to "ident" on loopback, which refuses the password the app uses.
PGHBA="$(sudo -u postgres psql -tAc 'SHOW hba_file')"
if grep -qE '^host[[:space:]]+all[[:space:]]+all[[:space:]]+(127\.0\.0\.1/32|::1/128)[[:space:]]+(ident|peer|trust)' "$PGHBA"; then
  log "Switching loopback authentication to scram-sha-256"
  cp -a "$PGHBA" "$PGHBA.bak.$(date +%s)"
  sed -i -E 's|^(host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1/32[[:space:]]+)(ident\|peer\|trust)|\1scram-sha-256|' "$PGHBA"
  sed -i -E 's|^(host[[:space:]]+all[[:space:]]+all[[:space:]]+::1/128[[:space:]]+)(ident\|peer\|trust)|\1scram-sha-256|' "$PGHBA"
  systemctl reload postgresql
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
