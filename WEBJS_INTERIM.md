# Interim provider: whatsapp-web.js

This is a **temporary bridge** for sending broadcasts before your Meta
WhatsApp Business Account (WABA) is approved (see [SETUP_META.md](./SETUP_META.md)).
Switch back to `cloud_api` as soon as you're verified.

## What it is

[whatsapp-web.js](https://wwebjs.dev/) automates a real WhatsApp Web session
via a headless browser (Puppeteer). You link it to your phone once by
scanning a QR code, and from then on this app can send messages through that
session — no Meta approval, no Business Manager, no template review.

## Why this is a real tradeoff, not a free lunch

- **It violates WhatsApp's Terms of Service.** Automated/bulk sending
  through the consumer client is explicitly prohibited.
- **Ban risk is real.** WhatsApp's anti-abuse systems are built to catch
  exactly this pattern: a number suddenly sending templated marketing text
  to many numbers that haven't messaged it first. A ban can hit the whole
  number/device with no appeal process.
- **No official delivery guarantees.** Message acks (`delivered`/`read`) come
  from the session itself and stop working the moment the session drops.
- **Fragile.** It breaks whenever WhatsApp changes WhatsApp Web internals,
  until the library catches up.

**Given that, use it conservatively:**
- Only message contacts who've genuinely opted in (the system already
  enforces this at the DB level).
- Keep volume low — tens of messages a day, not hundreds, especially in the
  first couple of weeks on a given number. Lower `MESSAGES_PER_SECOND` and
  `TIER_LIMIT_PER_24H` in `.env` well below the defaults (which are sized for
  the official API's tier system, not for this).
- Treat it as a bridge to get a handful of real campaigns out while your
  Meta verification is in progress — not a long-term architecture.

## Setup

1. In `.env`, set:
   ```
   WHATSAPP_PROVIDER=web_js
   DRY_RUN=false
   ```
2. Log in once (opens a session and prints a QR code to your terminal):
   ```
   npm run whatsapp:login
   ```
   Scan it with your phone: WhatsApp > Settings > Linked Devices > Link a
   Device. The session is saved to `WHATSAPP_WEBJS_SESSION_PATH`
   (default `./data/wwebjs_auth`) so you won't need to re-scan on future runs.
3. Register a template with `bodyText` instead of (or alongside)
   `metaTemplateName` — this is the literal message text sent, with
   `{{1}}`, `{{2}}`, ... placeholders for variables:
   ```
   POST /templates
   { "name": "summer-sale", "bodyText": "Hi! Enjoy {{1}} off this week at our boutique. Reply STOP to unsubscribe.", "variableCount": 1 }
   ```
4. Create and send campaigns exactly as usual (`POST /campaigns`,
   `POST /campaigns/:id/send`, or `npm run send -- <id>`).

## Delivery status & opt-outs

These only work while the server process (`npm run dev` / `npm start`) stays
running with a live, logged-in session — a one-shot CLI send won't be around
to observe later replies or read receipts. Run the server if you want
opt-out replies (STOP) to actually suppress future sends.

## Switching to cloud_api later

Once your WABA is approved: set `WHATSAPP_PROVIDER=cloud_api`, fill in the
Cloud API credentials, and register templates with `metaTemplateName`
matching what Meta approved. Existing contacts, opt-in status, and campaign
history carry over unchanged — only the sending mechanism changes.
