import type Database from 'better-sqlite3';
import { WAState, Message } from 'whatsapp-web.js';
import { getWebJsClient, ensureReady } from './webjs-client';
import { markOptedOut } from '../services/contacts';
import { recordDeliveryStatus } from '../services/campaigns';
import { isOptOutMessage } from '../services/optOut';
import { updateAccountStatus } from '../services/accounts';

/**
 * Attaches inbound-message and delivery-ack listeners for one owner's
 * WhatsApp session. Only meaningful while the process stays running (e.g.
 * the server), since whatsapp-web.js delivers events over an active session.
 * Safe to call more than once for the same owner -- skips re-attaching if
 * this client instance already has listeners.
 */
export function startWebJsListeners(db: Database.Database, owner: string, proxyUrl?: string | null): void {
  const client = getWebJsClient(owner, proxyUrl);
  if (client.listenerCount('message') > 0) return; // already wired up for this client instance

  updateAccountStatus(db, owner, 'CONNECTING');

  client.on('qr', () => {
    updateAccountStatus(db, owner, 'QR_READY');
  });

  client.on('ready', () => {
    updateAccountStatus(db, owner, 'READY');
  });

  client.on('message', (message: Message) => {
    const phone = `+${message.from.replace('@c.us', '')}`;
    const body = message.body ?? '';
    const optOut = isOptOutMessage(body);

    db.prepare(
      `INSERT INTO inbound_messages (owner, contact_phone, body, triggered_opt_out) VALUES (?, ?, ?, ?)`
    ).run(owner, phone, body, optOut ? 1 : 0);

    if (optOut) markOptedOut(db, owner, phone);
  });

  // whatsapp-web.js ack levels: -1 error, 0 pending, 1 sent (server), 2 delivered (device), 3 read, 4 played.
  client.on('message_ack', (message: Message, ack: number) => {
    const wamid = message.id._serialized;
    if (ack === 2) recordDeliveryStatus(db, wamid, 'delivered');
    else if (ack === 3) recordDeliveryStatus(db, wamid, 'read');
    else if (ack === -1) recordDeliveryStatus(db, wamid, 'failed');
  });

  client.on('disconnected', (reason: WAState | string) => {
    updateAccountStatus(db, owner, 'DISCONNECTED');
    console.error(`[${owner}] whatsapp-web.js: session disconnected (${reason}). Reconnect via the dashboard's WhatsApp page.`);
  });

  // Connection Health Check / Heartbeat
  const heartbeatInterval = setInterval(async () => {
    try {
      if (client && client.pupPage && !client.pupPage.isClosed()) {
        const state = await client.getState();
        if (state === 'CONNECTED') {
          updateAccountStatus(db, owner, 'READY');
        } else if (state === 'UNPAIRED' || state === 'UNLAUNCHED') {
          updateAccountStatus(db, owner, 'DISCONNECTED');
        }
      }
    } catch (err) {
      console.warn(`[${owner}] Heartbeat check failed:`, (err as Error).message);
    }
  }, config.whatsapp.heartbeatIntervalMs);

  // Prevent memory leaks on listener detachment
  client.on('disconnected', () => clearInterval(heartbeatInterval));

  // Exponential Backoff auto-connect helper
  const connectWithRetry = async (attempt = 1, maxAttempts = 5) => {
    try {
      await ensureReady(owner, proxyUrl);
    } catch (err) {
      updateAccountStatus(db, owner, 'DISCONNECTED');
      if (attempt < maxAttempts) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.warn(`[${owner}] Connection attempt ${attempt} failed: ${(err as Error).message}. Retrying in ${delayMs}ms...`);
        setTimeout(() => connectWithRetry(attempt + 1, maxAttempts), delayMs);
      } else {
        console.error(`[${owner}] All ${maxAttempts} connection attempts failed. Giving up.`);
      }
    }
  };

  connectWithRetry();
}
