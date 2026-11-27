#!/usr/bin/env bash
# Creates a fully separate, license-enforced copy of the system for one customer.
# Own folder, own database, own WhatsApp sessions, own port, own PM2 process.
#
# Usage (run on the server):
#   scripts/new-instance.sh <name> <port> "<Customer Name>" <max_accounts> <expires YYYY-MM-DD> <admin_user> <admin_password> [dry]
# Example:
#   scripts/new-instance.sh customer-a 3011 "Customer A" 20 2027-01-31 customera 'S3cretPass'
#
# Add "dry" as the 8th argument to create it in DRY_RUN mode (no real WhatsApp sessions) for a trial.
# SRC (the folder to copy code from, already built) defaults to /opt/whatsapp-broadcast.
set -euo pipefail

if [ "$#" -lt 7 ]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

NAME="$1"; PORT="$2"; CUSTOMER="$3"; MAX="$4"; EXPIRES="$5"; ADMIN_USER="$6"; ADMIN_PASS="$7"; MODE="${8:-live}"
SRC="${SRC:-/opt/whatsapp-broadcast}"
DEST="/opt/whatsapp-${NAME}"
PM2_NAME="whatsapp-${NAME}"

[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "name must be lowercase letters, digits and dashes"; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || { echo "port must be 1024-65535"; exit 1; }
[[ "$MAX" =~ ^[0-9]+$ ]] || { echo "max_accounts must be a whole number"; exit 1; }
[[ "$EXPIRES" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "expires must be YYYY-MM-DD"; exit 1; }
[ -d "$SRC/dist" ] || { echo "$SRC has no dist/ build"; exit 1; }
[ ! -e "$DEST" ] || { echo "$DEST already exists - refusing to overwrite"; exit 1; }
if ss -tln | awk '{print $4}' | grep -q ":${PORT}\$"; then echo "port $PORT is already in use"; exit 1; fi
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then echo "PM2 process $PM2_NAME already exists"; exit 1; fi

DRY=false; [ "$MODE" = "dry" ] && DRY=true

echo "==> Copying code to $DEST (no data, no secrets)"
mkdir -p "$DEST"
tar -C "$SRC" --exclude=./data --exclude=./.env --exclude=./core --exclude=./app.db --exclude=./.wwebjs_cache -cf - . | tar -C "$DEST" -xf -
mkdir -p "$DEST/data"

echo "==> Writing .env (license enforced, DRY_RUN=$DRY)"
USERS_JSON=$(cd "$SRC" && ADMIN_USER="$ADMIN_USER" ADMIN_PASS="$ADMIN_PASS" node -e '
  const b=require("bcryptjs");
  console.log(JSON.stringify([{username:process.env.ADMIN_USER,passwordHash:b.hashSync(process.env.ADMIN_PASS,10)}]));')
{
  echo "LICENSE_ENFORCE=true"
  echo "DRY_RUN=$DRY"
  echo "PORT=$PORT"
  echo "DB_PATH=./data/app.db"
  echo "WHATSAPP_WEBJS_SESSION_PATH=./data/wwebjs_auth"
  echo "MAX_CONCURRENT_SESSIONS=$((MAX + 5))"
  echo "SESSION_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
  echo "DASHBOARD_USERS='${USERS_JSON}'"
} > "$DEST/.env"
chmod 600 "$DEST/.env"

echo "==> Creating database and installing the license"
( cd "$DEST" && node dist/cli/license.js set --customer "$CUSTOMER" --max "$MAX" --expires "$EXPIRES" --note "created by new-instance.sh" )

echo "==> Starting $PM2_NAME"
( cd "$DEST" && pm2 start dist/server.js --name "$PM2_NAME" --cwd "$DEST" --time >/dev/null )
pm2 save >/dev/null
sleep 5
curl -s "localhost:${PORT}/health" && echo

cat <<EOF

Done. $CUSTOMER is running at http://<server-ip>:${PORT}  (login: ${ADMIN_USER})
  Folder:   $DEST
  Process:  $PM2_NAME   (pm2 logs $PM2_NAME)
  License:  cd $DEST && node dist/cli/license.js show

Next steps for you:
  1. Give the customer a proper address: add an nginx server block + HTTPS for a name that points here
     and proxies to 127.0.0.1:${PORT} (or, for a quick test only, ufw allow ${PORT}/tcp).
  2. Give each of their WhatsApp accounts its own proxy from THEIR pool, then run the cross-customer check:
     node dist/cli/proxy-audit.js /opt/<instance-a>/data/app.db /opt/<instance-b>/data/app.db
EOF
