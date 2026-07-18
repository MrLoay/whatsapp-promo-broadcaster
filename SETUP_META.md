# Setting up WhatsApp Business Cloud API with Meta

None of this can be scripted — it's manual setup in Meta's dashboards. Do
this once; afterward, live sending just needs the resulting values in `.env`.

## 1. Business Manager & WhatsApp Business Account (WABA)

1. Go to business.facebook.com and create (or use an existing) Business
   Manager for your boutique.
2. In Meta for Developers (developers.facebook.com), create a new App, type
   "Business", and add the **WhatsApp** product to it.
3. This auto-creates a WhatsApp Business Account (WABA) and a free **test
   phone number** you can use immediately for development (limited to a few
   recipient numbers you manually verify).

## 2. Get a real business phone number

1. In the app's WhatsApp > API Setup screen, add your boutique's real phone
   number (must not already be active on regular WhatsApp/Business App —
   you'll need to migrate or use a number never registered with WhatsApp).
2. Verify it via SMS/voice code.
3. Note the **Phone Number ID** and **WhatsApp Business Account ID** shown on
   this screen — these go in `.env` as `WHATSAPP_PHONE_NUMBER_ID` and
   `WHATSAPP_BUSINESS_ACCOUNT_ID`.

## 3. Generate a permanent access token

The token shown by default in API Setup is temporary (24h). For a running
service you need a permanent one:

1. Business Settings > Users > System Users > Add.
2. Create a System User with Admin role, assign it to your WhatsApp app with
   `whatsapp_business_messaging` and `whatsapp_business_management`
   permissions.
3. Generate a token for that System User (no expiry). Put it in `.env` as
   `WHATSAPP_ACCESS_TOKEN`.

## 4. Submit message templates

Any promotional message sent outside a customer-initiated 24h window must
use a pre-approved template.

1. WhatsApp Manager > Message Templates > Create Template.
2. Category: **Marketing**. Write the body with `{{1}}`, `{{2}}`, ... for
   variables (e.g. discount code, name).
3. Submit for review — Meta typically approves/rejects within a few hours to
   a day. Rejections are usually about vague/misleading copy or missing
   opt-out language — include something like "Reply STOP to unsubscribe."
4. Once approved, register it locally via `POST /templates` using the exact
   template name and language code Meta assigned.

## 5. Register the webhook

1. Deploy this app somewhere reachable (or use `ngrok http 3000` while
   developing) and note the public URL, e.g. `https://xxxx.ngrok.app/webhook`.
2. In App Dashboard > WhatsApp > Configuration, set the Callback URL to that
   address and the Verify Token to whatever you set as
   `WEBHOOK_VERIFY_TOKEN` in `.env`.
3. Subscribe to the `messages` webhook field (delivers both inbound messages
   and delivery status updates).
4. Copy the App Secret (App Dashboard > Settings > Basic) into `.env` as
   `META_APP_SECRET` — this is required for signature verification once you
   go live; without it, incoming webhook requests aren't authenticated.

## 6. Go live

- Set `DRY_RUN=false` in `.env`.
- Note: to message contacts beyond the ~5 test numbers, Meta requires
  **Business Verification** (submitting business documents) — this can take
  a few days. Start it early.
- Start conservative: your number begins at messaging tier 1 (250 unique
  contacts/24h). Keep `TIER_LIMIT_PER_24H=250` until Meta upgrades your tier
  (visible in WhatsApp Manager > Phone Numbers), which happens automatically
  as you maintain a good quality rating.
