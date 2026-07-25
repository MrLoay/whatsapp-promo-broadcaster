import { Router, raw } from 'express';
import { config } from '../config';
import { getDb } from '../db';
import { verifyWebhookSignature } from '../whatsapp/signature';
import { markOptedOut } from '../services/contacts';
import { recordDeliveryStatus } from '../services/campaigns';
import { isOptOutMessage } from '../services/optOut';

export const webhookRouter = Router();

// Meta's verification handshake when you register the webhook URL.
webhookRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.webhook.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Use raw body here so the HMAC signature check is over the exact bytes Meta sent.
webhookRouter.post('/webhook', raw({ type: 'application/json' }), (req, res) => {
  const signature = req.header('X-Hub-Signature-256');
  if (!verifyWebhookSignature(req.body as Buffer, signature)) {
    return res.sendStatus(401);
  }

  const payload = JSON.parse((req.body as Buffer).toString('utf-8'));
  const db = getDb();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const status of value.statuses ?? []) {
        if (['delivered', 'read', 'failed', 'sent'].includes(status.status)) {
          recordDeliveryStatus(db, status.id, status.status);
        }
      }

      for (const message of value.messages ?? []) {
        const body: string = message.text?.body ?? '';
        const phone: string = message.from?.startsWith('+') ? message.from : `+${message.from}`;
        const isOptOut = isOptOutMessage(body);

        db.prepare(
          `INSERT INTO inbound_messages (contact_phone, body, triggered_opt_out) VALUES (?, ?, ?)`
        ).run(phone, body, isOptOut ? 1 : 0);

        if (isOptOut) markOptedOut(db, phone);
      }
    }
  }

  res.sendStatus(200);
});
