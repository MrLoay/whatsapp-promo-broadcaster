# Deploying on a plain Linux VPS (SSH access)

Use this instead of DEPLOY.md when you have direct SSH access to a server
(e.g. a friend's box) rather than a managed platform like Render. A normal
VPS's disk is already persistent, so there's no special disk-mounting step
like Render's -- the SQLite file just lives on the server's own filesystem.

## 1. Connect

```
ssh <your-username>@<server-ip-or-domain>
```

## 2. Install Node.js (if not already there)

Check first:
```
node -v
```
Need v18+. If missing or too old:
```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

## 3. Clone the repo

```
git clone https://github.com/MrLoay/whatsapp-promo-broadcaster.git
cd whatsapp-promo-broadcaster
npm install
npm run build
```

## 4. Create `.env`

```
nano .env
```
Paste in (adjust values):
```
DRY_RUN=true
WHATSAPP_PROVIDER=cloud_api
PORT=3000
DB_PATH=./data/app.db
SESSION_SECRET=<a long random string>
DASHBOARD_USERS=[{"username":"loay","passwordHash":"<hash>"},{"username":"assistant","passwordHash":"<hash>"}]
```
Generate each password hash **locally first** (on your own PC, not the
server) with `npm run hash-password -- <plaintext>`, then paste the results
in here. Add Meta credentials later per SETUP_META.md once you have them.

Save and exit (Ctrl+O, Enter, Ctrl+X in nano).

## 5. Keep it running with PM2

A plain `node dist/server.js` dies the moment your SSH session disconnects.
PM2 keeps it running in the background and restarts it if it crashes.

```
sudo npm install -g pm2
pm2 start dist/server.js --name whatsapp-broadcast
pm2 save
pm2 startup    # follow the printed instructions to survive server reboots
```

Useful commands:
```
pm2 logs whatsapp-broadcast     # view live logs
pm2 restart whatsapp-broadcast  # after pulling new code + rebuilding
```

## 6. Open the port / reach it

If there's a firewall (`ufw`), allow the port:
```
sudo ufw allow 3000
```
Then visit `http://<server-ip-or-domain>:3000/login.html`.

## 7. (Recommended once you have a domain) Put HTTPS in front of it

Running plain HTTP means your login password and session cookie travel
unencrypted -- fine for a quick temporary test, but worth fixing before
real use. If your friend's server has a domain pointed at it:

```
sudo apt-get install -y nginx certbot python3-certbot-nginx
```
Configure nginx to reverse-proxy your domain to `localhost:3000`, then:
```
sudo certbot --nginx -d yourdomain.com
```
This gets you a free auto-renewing TLS certificate and `https://` access.

## Updating after code changes

```
cd whatsapp-promo-broadcaster
git pull
npm install
npm run build
pm2 restart whatsapp-broadcast
```

## Moving to Render later

When you're ready to pay for Render (or any managed host), nothing about
the app changes -- just follow [DEPLOY.md](./DEPLOY.md) there and stop the
PM2 process on the VPS once Render is confirmed working.
