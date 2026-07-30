# WhatsApp Boutique Broadcast

A small web dashboard + backend for sending WhatsApp promotional broadcasts
to your boutique's contact list — with opt-in tracking, one-click "type a
message and send to everyone" campaigns, and automatic STOP/opt-out handling.

**You cannot legally or technically send unsolicited promotional WhatsApp
messages.** Every send in this system only targets contacts explicitly marked
`opted_in`, and any inbound "STOP" reply automatically suppresses future
sends to that contact.

## How sending works right now

This currently sends via **whatsapp-web.js**, an unofficial bridge that
drives a real WhatsApp Web session — no Meta Business approval needed to get
started, but it violates WhatsApp's Terms of Service and carries a real risk
of the number getting restricted/banned. Read
[WEBJS_INTERIM.md](./WEBJS_INTERIM.md) before sending anything real. The
official Meta Cloud API integration (ban-safe, requires WABA approval) will
come back once that approval is in hand — see [SETUP_META.md](./SETUP_META.md).

## Setup

```
npm install
copy .env.example .env
npm run build
npm test
```

Set `DRY_RUN=true` (the default) to test the whole pipeline without sending
anything real — the client logs what it *would* send.

## Usage

### 1. Create a dashboard login

```
npm run hash-password -- <your-password>
```
Paste the printed hash into `DASHBOARD_USERS` in `.env`:
```
DASHBOARD_USERS=[{"username":"you","passwordHash":"<hash>"}]
```
Run it again for anyone else who needs access (e.g. an assistant), and add
them to the same array.

### 2. Start the server

```
npm run dev
```
Open `http://localhost:3000/login.html`.

### 3. Import contacts

On the **Contacts** page: add one at a time, or paste a CSV with columns
`phone,name,opted_in` (phone must be E.164, e.g. `+15551234567`; only
`opted_in=true` rows are ever messaged).

### 4. Connect WhatsApp

On the **WhatsApp** page (once `DRY_RUN=false`): click **Connect WhatsApp**,
scan the QR code with your phone (Settings > Linked Devices > Link a
Device). The session is saved, so you won't need to re-scan on future runs
unless you click **Disconnect**.

### 5. Send a broadcast

On the **Home** page: type a message and click **Send to all contacts**. Use
`{{name}}` anywhere in the message and each contact's own name is filled in
automatically. This sends immediately to every opted-in contact — no draft
step.

## Rate limits

Keep volume conservative with `web_js` — it doesn't have the official API's
tiered rate limits, and looks more like spam to WhatsApp's abuse detection
the faster it sends. `TIER_LIMIT_PER_24H` and `MESSAGES_PER_SECOND` in `.env`
throttle sends; `sendCampaign` stops queuing new sends once it would exceed
the 24h limit, and resuming later picks up where it left off.
