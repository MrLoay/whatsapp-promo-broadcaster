# WhatsApp Boutique Broadcast

A small backend for sending WhatsApp promotional broadcasts to your boutique's
contact list via the official WhatsApp Business Cloud API — with opt-in
tracking, message templates, throttled campaign sends, and delivery-status /
opt-out webhooks.

**You cannot legally or technically send unsolicited promotional WhatsApp
messages.** Every send in this system only targets contacts explicitly marked
`opted_in`, and any inbound "STOP" reply automatically suppresses future
sends to that contact.

## Status: works in DRY_RUN mode today

You don't have a Meta WhatsApp Business account yet, so `DRY_RUN=true` (the
default) makes the whole pipeline — import, campaign creation, sending,
delivery-status updates, opt-out handling — runnable and testable locally.
No real messages are sent; the client logs what it *would* send. Once your
WABA is approved, follow [SETUP_META.md](./SETUP_META.md) and flip
`DRY_RUN=false`.

Need to send real broadcasts *before* your WABA is approved? There's an
interim `web_js` provider (unofficial, ToS-violating, ban risk) — see
[WEBJS_INTERIM.md](./WEBJS_INTERIM.md) before using it.

## Setup

```
npm install
copy .env.example .env
npm run build
npm test
```

## Usage

### 1. Import contacts

CSV with columns `phone,name,opted_in` (phone must be E.164, e.g.
`+15551234567`; `opted_in` is `true`/`false` — only `true` rows are eligible
for campaigns):

```
npm run import -- contacts.csv
```

### 2. Register a template

Templates must already be approved in Meta Business Manager — this just
records the mapping locally (via the REST API, once the server is running):

```
POST /templates
{ "name": "summer-sale", "metaTemplateName": "summer_sale_promo", "language": "en_US", "variableCount": 1 }
```

### 3. Create and send a campaign

```
POST /campaigns
{ "name": "Summer Sale", "templateId": 1, "variableValues": ["20%"] }

POST /campaigns/1/send
```

or via CLI: `npm run send -- 1`

### 4. Run the server (for webhooks + REST API)

```
npm run dev
```

Webhook endpoint: `GET/POST /webhook` — register this URL (with your
`WEBHOOK_VERIFY_TOKEN`) in the Meta App Dashboard once you have a public URL
(e.g. via ngrok during development).

## Rate limits

New WhatsApp Business numbers start in a tier capped at 250 unique contacts
messaged per rolling 24 hours; this grows automatically as your number
maintains a good quality rating. `TIER_LIMIT_PER_24H` in `.env` should match
your current tier — `sendCampaign` stops queuing new sends once it would
exceed that limit, and resuming the campaign later picks up where it left off.
