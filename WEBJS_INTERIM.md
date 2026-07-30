# Current sending method: whatsapp-web.js

This is a **temporary bridge** for sending broadcasts before a Meta WhatsApp
Business Account (WABA) is approved (see [SETUP_META.md](./SETUP_META.md)).
The official Meta Cloud API integration will come back once that's in hand.

## What it is

[whatsapp-web.js](https://wwebjs.dev/) automates a real WhatsApp Web session
via a headless browser (Puppeteer). You link it to your phone once by
scanning a QR code (via the dashboard's **WhatsApp** page), and from then on
this app can send messages through that session — no Meta approval, no
Business Manager, no template review.

## Why this is a real tradeoff, not a free lunch

- **It violates WhatsApp's Terms of Service.** Automated/bulk sending
  through the consumer client is explicitly prohibited.
- **Ban risk is real.** WhatsApp's anti-abuse systems are built to catch
  exactly this pattern: a number suddenly sending templated marketing text
  to many numbers that haven't messaged it first. A ban can hit the whole
  number/device with no appeal process. This has already happened once
  during this project's development.
- **No official delivery guarantees.** Message acks (`delivered`/`read`) come
  from the session itself and stop working the moment the session drops.
  Sometimes the library can't even confirm whether a send succeeded --
  those get marked `failed` on purpose rather than guessed at, since a wrong
  guess either way causes real problems (missed messages or duplicates).
- **Fragile.** It breaks whenever WhatsApp changes WhatsApp Web internals,
  until the library catches up.

**Given that, use it conservatively:**
- Only message contacts who've genuinely opted in (the system already
  enforces this at the DB level).
- Keep volume low — tens of messages a day, not hundreds, especially in the
  first couple of weeks on a given number. `MESSAGES_PER_SECOND` and
  `TIER_LIMIT_PER_24H` in `.env` throttle sends -- keep them low.
- Treat it as a bridge to get real campaigns out while Meta verification is
  in progress — not a long-term architecture.

## Setup

1. In `.env`, set `DRY_RUN=false`.
2. On the dashboard's **WhatsApp** page, click **Connect WhatsApp** and scan
   the QR code shown with your phone: Settings > Linked Devices > Link a
   Device. The session is saved to `WHATSAPP_WEBJS_SESSION_PATH` (default
   `./data/wwebjs_auth`), so you won't need to re-scan on future runs unless
   you click **Disconnect**.
3. On the **Home** page, type a message and click **Send to all contacts**.

## Delivery status & opt-outs

These only work while the server process (`npm run dev` / `npm start`) stays
running with a live, logged-in session -- opt-out replies (STOP) and
delivery/read receipts are only observed while the server is up.

## Moving to the official Cloud API later

Once a WABA is approved, the Meta Cloud API sending path will be reinstated
alongside this one. Existing contacts, opt-in status, and campaign history
carry over unchanged — only the sending mechanism changes.
