# Deploying the dashboard (Render.com)

This gets the dashboard reachable by you and your assistant from anywhere,
with a persistent disk so the SQLite database survives restarts/deploys.

## 1. Push your latest code to GitHub

```
git add -A
git commit -m "..."
git push
```

## 2. Create the Web Service

1. Go to render.com, sign up/log in, click **New > Web Service**.
2. Connect your GitHub account and select the `whatsapp-promo-broadcaster` repo.
3. Configure:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance type**: the free tier works for testing, but it spins down
     after inactivity and loses anything not on the persistent disk (see
     below) between spin-ups. A paid "Starter" instance stays always-on --
     worth it once you're using this for real, especially if using the
     `web_js` provider (see the warning below).

## 3. Add a persistent disk

Render's free tier filesystem is ephemeral -- your contacts/campaigns
database would vanish on every restart without this.

1. In the service's **Disks** tab, add a disk (1 GB is plenty), mount path:
   `/opt/render/project/src/data`
2. Set the environment variable `DB_PATH=/opt/render/project/src/data/app.db`
   (and `WHATSAPP_WEBJS_SESSION_PATH=/opt/render/project/src/data/wwebjs_auth`
   if using that provider).

## 4. Set environment variables

In the service's **Environment** tab, add everything from your local `.env`
(never commit `.env` itself -- it's gitignored). At minimum:

```
DRY_RUN=true
WHATSAPP_PROVIDER=cloud_api
SESSION_SECRET=<a long random string>
DASHBOARD_USERS=[{"username":"loay","passwordHash":"..."},{"username":"assistant","passwordHash":"..."}]
```

Generate each password hash locally first:
```
npm run hash-password -- <plaintext-password>
```
Run it once per person, and combine the outputs into the `DASHBOARD_USERS`
JSON array above.

Add the Meta Cloud API credentials (`WHATSAPP_ACCESS_TOKEN`, etc.) once you
have them -- see [SETUP_META.md](./SETUP_META.md).

## 5. Deploy

Render deploys automatically on every push to `main` once connected. Watch
the deploy logs for the first run; visit `https://<your-service>.onrender.com/login.html`
once it's live.

## A note on the `web_js` provider and hosting

`web_js` requires a real, once-authenticated browser session (`npm run
whatsapp:login`) tied to the disk where its session data lives. This is
fragile on a hosted platform:
- The free tier's spin-down/spin-up cycle can drop the session, requiring
  you to re-run the login flow (which needs an interactive terminal --
  awkward on a hosted service).
- You already saw firsthand that `web_js` usage can get an account
  restricted. Running it unattended, remotely, makes that risk harder to
  monitor.

**Recommendation**: once deployed for real use, switch to `cloud_api`
(official Meta) or a BSP-backed provider -- both are stateless from this
app's perspective and don't have this fragility.
