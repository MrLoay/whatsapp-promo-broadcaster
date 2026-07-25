import type Database from 'better-sqlite3';
import { WAState, Message } from 'whatsapp-web.js';
import { getWebJsClient, ensureReady } from './webjs-client';
import { markOptedOut } from '../services/contacts';
import { recordDeliveryStatus } from '../services/campaigns';
import { isOptOutMessage } from '../services/optOut';

/**
 * Attaches inbound-message and delivery-ack listeners for the web_js
 * provider. Only meaningful while the process stays running (e.g. the
 * server), since whatsapp-web.js delivers events over an active session --
 * a one-shot CLI send won't be around to observe later acks/replies.
 */
export function startWebJsListeners(db: Database.Database): void {
  const client = getWebJsClient();

  client.on('message', (message: Message) => {
    const phone = `+${message.from.replace('@c.us', '')}`;
    const body = message.body ?? '';
    const optOut = isOptOutMessage(body);

    db.prepare(
      `INSERT INTO inbound_messages (contact_phone, body, triggered_opt_out) VALUES (?, ?, ?)`
    ).run(phone, body, optOut ? 1 : 0);

    if (optOut) markOptedOut(db, phone);
  });

  // whatsapp-web.js ack levels: -1 error, 0 pending, 1 sent (server), 2 delivered (device), 3 read, 4 played.
  client.on('message_ack', (message: Message, ack: number) => {
    const wamid = message.id._serialized;
    if (ack === 2) recordDeliveryStatus(db, wamid, 'delivered');
    else if (ack === 3) recordDeliveryStatus(db, wamid, 'read');
    else if (ack === -1) recordDeliveryStatus(db, wamid, 'failed');
  });

  client.on('disconnected', (reason: WAState | string) => {
    console.error(`whatsapp-web.js: session disconnected (${reason}). Run "npm run whatsapp:login" to reconnect.`);
  });

  ensureReady().catch((err) => console.error('whatsapp-web.js failed to start:', err.message));
}
