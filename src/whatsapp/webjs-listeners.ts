import type Database from 'better-sqlite3';
import { WAState, Message } from 'whatsapp-web.js';
import { getWebJsClient, ensureReady } from './webjs-client';
import { markOptedOut } from '../services/contacts';
import { recordDeliveryStatus } from '../services/campaigns';
import { isOptOutMessage } from '../services/optOut';
import { updateAccountStatus } from '../services/accounts';
import { config } from '../config';

/**
 * Attaches inbound-message and delivery-ack listeners for one owner's
 * WhatsApp session. Only meaningful while the process stays running (e.g.
 * the server), since whatsapp-web.js delivers events over an active session.
 * Safe to call more than once for the same owner -- skips re-attaching if
 * this client instance already has listeners.
 */
function wireClientEvents(db: Database.Database, owner: string, client: any, proxyUrl?: string | null): void {
  if (!client || client.listenerCount('message') > 0) return;

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

  client.on('message_ack', (message: Message, ack: number) => {
    const wamid = message.id._serialized;
    if (ack === 2) recordDeliveryStatus(db, wamid, 'delivered');
    else if (ack === 3) recordDeliveryStatus(db, wamid, 'read');
    else if (ack === -1) recordDeliveryStatus(db, wamid, 'failed');
  });

  client.on('disconnected', (reason: WAState | string) => {
    updateAccountStatus(db, owner, 'DISCONNECTED');
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      category: 'SESSION_DISCONNECTED',
      owner,
      proxyUrl: proxyUrl || null,
      reason,
      message: `[${owner}] WhatsApp session disconnected. Reason: ${reason}`
    }));
  });

  // Connection Health Check / Heartbeat (with initial random jitter to avoid all accounts spiking CPU simultaneously)
  const jitterMs = Math.floor(Math.random() * 30000);
  let heartbeatInterval: NodeJS.Timeout | null = null;
  const initialTimeout = setTimeout(() => {
    heartbeatInterval = setInterval(async () => {
      try {
        if (client && client.pupPage && !client.pupPage.isClosed()) {
          const { getConnectionState } = require('./webjs-client');
          const s = getConnectionState(owner);
          // Only run heartbeat check if the session is already authenticated or ready.
          // Never query getState() on accounts waiting for a QR scan, connecting, or idle!
          if (s.status !== 'ready' && s.status !== 'authenticated') return;

          const statePromise = client.getState();
          const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('getState timeout (25s)')), 25000)
          );
          const state = await Promise.race([statePromise, timeoutPromise]);

          if (state === 'CONNECTED') {
            updateAccountStatus(db, owner, 'READY');
          } else if (state === 'UNPAIRED' || state === 'UNLAUNCHED') {
            updateAccountStatus(db, owner, 'DISCONNECTED');
          }
        }
      } catch (err) {
        const errorMsg = (err as Error)?.message || String(err || 'Unknown error');
        if (errorMsg.includes('Target closed') || errorMsg.includes('Session closed')) {
          updateAccountStatus(db, owner, 'DISCONNECTED');
          return;
        }
        if (errorMsg.includes('detached Frame') || errorMsg.includes('timeout')) {
          // Tab is busy or recovering; ignore transient detached frame
          return;
        }
        const isProxyErr = errorMsg.includes('net::ERR_PROXY') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('ECONNREFUSED');
        const isSocketErr = errorMsg.includes('WebSocket');
        
        console.warn(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'WARN',
          category: isProxyErr ? 'PROXY_TIMEOUT' : isSocketErr ? 'SOCKET_DEAD' : 'HEARTBEAT_FAILURE',
          owner,
          proxyUrl: proxyUrl || null,
          error: errorMsg
        }));
      }
    }, Math.max(config.whatsapp.heartbeatIntervalMs, 90000));
  }, jitterMs);

  client.on('disconnected', () => {
    clearTimeout(initialTimeout);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  });
}

// Concurrency gate: strictly 1 Chromium instance initializes at a time to prevent CPU / RAM spikes
const MAX_CONCURRENT_INITIALIZATIONS = 1;
let activeInitializations = 0;
const launchQueue: Array<() => void> = [];

function acquireInitSlot(): Promise<void> {
  if (activeInitializations < MAX_CONCURRENT_INITIALIZATIONS) {
    activeInitializations++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    launchQueue.push(() => {
      activeInitializations++;
      resolve();
    });
  });
}

function releaseInitSlot(): void {
  activeInitializations = Math.max(0, activeInitializations - 1);
  if (launchQueue.length > 0 && activeInitializations < MAX_CONCURRENT_INITIALIZATIONS) {
    const next = launchQueue.shift();
    if (next) next();
  }
}

export async function startWebJsListeners(db: Database.Database, owner: string, proxyUrl?: string | null): Promise<void> {
  updateAccountStatus(db, owner, 'CONNECTING');

  const connectWithRetry = async (attempt = 1, maxAttempts = 2) => {
    let slotReleased = false;
    await acquireInitSlot();
    const releaseOnce = () => {
      if (!slotReleased) {
        slotReleased = true;
        releaseInitSlot();
      }
    };

    try {
      const initialClient = await getWebJsClient(owner, proxyUrl);
      wireClientEvents(db, owner, initialClient, proxyUrl);

      // Release slot ONLY once account is genuinely ready, has rendered QR, or hit timeout
      const slotTimer = setTimeout(releaseOnce, 35000);
      initialClient.once('qr', () => { clearTimeout(slotTimer); releaseOnce(); });
      initialClient.once('authenticated', () => { clearTimeout(slotTimer); releaseOnce(); });
      initialClient.once('ready', () => { clearTimeout(slotTimer); releaseOnce(); });

      const client = await ensureReady(owner, proxyUrl);
      clearTimeout(slotTimer);
      releaseOnce();
      wireClientEvents(db, owner, client, proxyUrl);
    } catch (err) {
      releaseOnce();
      const errorMsg = (err as Error)?.message || String(err || 'Unknown error');
      
      // Forcibly destroy failed client & kill browser to prevent zombie memory leaks
      try {
        const { disconnect } = require('./webjs-client');
        await disconnect(owner);
      } catch {}

      if (attempt >= maxAttempts) {
        updateAccountStatus(db, owner, 'DISCONNECTED');
      }
      
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        category: errorMsg.includes('Failed to launch') ? 'CHROMIUM_CRASH' : 'CONNECT_FAILURE',
        owner,
        proxyUrl: proxyUrl || null,
        attempt,
        maxAttempts,
        error: errorMsg
      }));

      if (attempt < maxAttempts) {
        const delayMs = 5000;
        setTimeout(() => connectWithRetry(attempt + 1, maxAttempts), delayMs);
      }
    } finally {
      releaseOnce();
    }
  };

  connectWithRetry();
}
