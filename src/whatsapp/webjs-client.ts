import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import { config } from '../config';

export type ConnectionStatus = 'idle' | 'connecting' | 'qr' | 'authenticated' | 'ready' | 'error';

interface Session {
  client: Client | null;
  readyPromise: Promise<Client> | null;
  connectionStatus: ConnectionStatus;
  latestQr: string | null;
  lastError: string | null;
  cleanup?: () => void;
}

// Each dashboard account (owner) gets its own WhatsApp session
const sessions = new Map<string, Session>();

function getSession(owner: string): Session {
  let session = sessions.get(owner);
  if (!session) {
    session = { client: null, readyPromise: null, connectionStatus: 'idle', latestQr: null, lastError: null };
    sessions.set(owner, session);
  }
  return session;
}

export function getActiveSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.client) count++;
  }
  return count;
}

export function getConnectionState(owner: string): { 
  status: ConnectionStatus; 
  qr: string | null; 
  error: string | null;
  phone: string | null;
  pushname: string | null;
} {
  const s = getSession(owner);
  const isReady = s.connectionStatus === 'ready';
  const qr = (!isReady && s.latestQr) ? s.latestQr : null;
  const phone = s.client?.info?.wid?.user ? `+${s.client.info.wid.user}` : null;
  const pushname = s.client?.info?.pushname || null;
  return { status: s.connectionStatus, qr, error: s.lastError, phone, pushname };
}

/**
 * Unofficial interim bridge (drives a real WhatsApp Web session via
 * Puppeteer) for use before a Meta WhatsApp Business account is approved.
 * Violates WhatsApp's ToS for bulk/automated sending -- carries real ban
 * risk.
 */
import * as proxyChain from 'proxy-chain';

export async function getWebJsClient(owner: string, proxyUrl?: string | null): Promise<Client> {
  const s = getSession(owner);
  if (!s.client) {
    let activeCount = 0;
    for (const session of sessions.values()) {
      if (session.client) activeCount++;
    }
    if (activeCount >= config.whatsapp.maxConcurrentSessions) {
      throw new Error(`Max active WhatsApp sessions limit (${config.whatsapp.maxConcurrentSessions}) reached. Cannot launch more Chromium processes.`);
    }

    const puppeteerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--js-flags=--max-old-space-size=512'
    ];
    let localBridgeUrl: string | null = null;

    if (proxyUrl) {
      try {
        localBridgeUrl = await proxyChain.anonymizeProxy(proxyUrl);
        console.log(`[${owner}] Proxy local anonymized bridge established: ${localBridgeUrl}`);
        puppeteerArgs.push(`--proxy-server=${localBridgeUrl}`);
      } catch (err) {
        console.error(`[${owner}] Failed to create proxy bridge, falling back:`, err);
        let formattedProxy = proxyUrl;
        try {
          const u = new URL(proxyUrl);
          formattedProxy = `${u.protocol}//${u.hostname}:${u.port}`;
        } catch {}
        puppeteerArgs.push(`--proxy-server=${formattedProxy}`);
      }
    }

    const safeClientId = owner.replace(/[^a-zA-Z0-9_-]/g, '_');
    s.client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.whatsapp.webjsSessionPath, clientId: safeClientId }),
      puppeteer: {
        headless: true,
        args: puppeteerArgs,
        timeout: 60000,
        protocolTimeout: 120000
      }
    });

    // Setup cleanup function
    s.cleanup = () => {
      if (localBridgeUrl) {
        proxyChain.closeAnonymizedProxy(localBridgeUrl, true).catch(() => {});
      }
    };

    s.client.on('disconnected', () => {
      if (s.cleanup) s.cleanup();
    });
  }
  return s.client;
}

function resetForRetry(owner: string): void {
  // A failed launch/auth attempt must not be cached forever -- otherwise the
  // dashboard's "Connect" button looks like it retries but silently returns
  // the same stale rejected promise every time. Clearing both lets the next
  // ensureReady() call build a fresh Client and actually try again.
  const s = getSession(owner);
  const oldClient = s.client;
  if (s.cleanup) {
    s.cleanup();
    s.cleanup = undefined;
  }
  s.client = null;
  s.readyPromise = null;
  s.latestQr = null; // Wipe stale QR on reset!
  if (oldClient) {
    oldClient.destroy().catch(() => {});
  }
}

export async function ensureReady(owner: string, proxyUrl?: string | null): Promise<Client> {
  const s = getSession(owner);
  s.lastError = null; // Clear any old error on new attempt
  if (s.connectionStatus === 'error' || s.connectionStatus === 'idle') {
    s.connectionStatus = 'connecting';
  }
  if (s.readyPromise) return s.readyPromise;

  s.readyPromise = new Promise<Client>(async (resolve, reject) => {
    try {
      const c = await getWebJsClient(owner, proxyUrl);
      c.on('qr', (qr) => {
        s.connectionStatus = 'qr';
        s.latestQr = qr;
        s.lastError = null;
        console.log(`\n[${owner}] Scan this QR code in WhatsApp on your phone: Settings > Linked Devices > Link a Device\n`);
        qrcodeTerminal.generate(qr, { small: true });
      });

      c.on('authenticated', () => {
        s.connectionStatus = 'authenticated';
        s.latestQr = null;
        s.lastError = null;
        console.log(`[${owner}] whatsapp-web.js: authenticated, session saved for next time.`);
      });
      c.on('auth_failure', (msg) => {
        s.connectionStatus = 'error';
        s.lastError = msg;
        s.latestQr = null;
        resetForRetry(owner);
        reject(new Error(`whatsapp-web.js auth failure: ${msg}`));
      });
      c.on('ready', () => {
        s.connectionStatus = 'ready';
        s.latestQr = null;
        s.lastError = null;
        console.log(`[${owner}] whatsapp-web.js: client ready.`);
        resolve(c);
      });
      c.on('disconnected', () => {
        s.connectionStatus = 'idle';
        s.latestQr = null;
        resetForRetry(owner);
      });
      c.initialize().catch((err) => {
        s.connectionStatus = 'error';
        s.lastError = err.message;
        s.latestQr = null;
        resetForRetry(owner);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });

  return s.readyPromise;
}

/** Logs out of WhatsApp (clears the saved session -- next connect needs a fresh QR scan) and resets state. */
export async function disconnect(owner: string): Promise<void> {
  const s = getSession(owner);
  const c = s.client;
  s.client = null;
  s.readyPromise = null;
  s.connectionStatus = 'idle';
  s.latestQr = null;
  s.lastError = null;
  if (s.cleanup) {
    s.cleanup();
    s.cleanup = undefined;
  }
  
  if (c) {
    const withTimeout = (promise: Promise<any>, ms: number) =>
      Promise.race([promise, new Promise((res) => setTimeout(res, ms))]);

    try {
      await withTimeout(c.logout(), 2000);
    } catch {
      // Best-effort -- state is already reset above
    }
    try {
      if (c.pupBrowser) {
        await withTimeout(c.pupBrowser.close(), 2000);
      }
    } catch {
      /* process may already be closed */
    }
    try {
      await withTimeout(c.destroy(), 2000);
    } catch {
      /* already torn down */
    }
  }
}

import fs from 'fs';
import { MessageMedia } from 'whatsapp-web.js';

export async function sendTextMessage(
  owner: string, 
  toPhoneE164: string, 
  text: string, 
  mediaPath?: string, 
  mediaMimeType?: string
): Promise<{ id: string }> {
  if (config.dryRun) {
    const fakeId = `dryrun-webjs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[DRY_RUN web_js][${owner}] Would send to ${toPhoneE164}:\n${text}\nMedia: ${mediaPath ?? 'None'}`);
    return { id: fakeId };
  }

  const s = getSession(owner);
  if (s.connectionStatus !== 'ready' || !s.client) {
    throw new Error(`WhatsApp session for ${owner} is not ready (status: ${s.connectionStatus})`);
  }
  const c = s.client;
  
  const rawNumber = toPhoneE164.replace(/^\+/, '');

  const registered = await c.getNumberId(rawNumber);
  if (!registered) {
    throw new Error(`${toPhoneE164} is not a registered WhatsApp number (or is unreachable) -- skipped.`);
  }

  let messageContent: string | MessageMedia = text;
  let options: any = { waitUntilMsgSent: true };

  if (mediaPath && fs.existsSync(mediaPath)) {
    try {
      messageContent = MessageMedia.fromFilePath(mediaPath);
      if (text) {
        options.caption = text;
      }
    } catch (err) {
      console.error(`[${owner}] Failed to load media from ${mediaPath}:`, err);
      // Fallback to text only if media fails
      messageContent = text;
    }
  }

  let message: any = null;
  try {
    message = await c.sendMessage(registered._serialized, messageContent, options);
  } catch (err) {
    // Fallback without waitUntilMsgSent if that option was rejected by the page
    message = await c.sendMessage(registered._serialized, messageContent, { caption: options.caption });
  }

  let wamid: string | null = null;
  if (message?.id?._serialized) {
    wamid = message.id._serialized;
  } else if (typeof message?.id === 'string') {
    wamid = message.id;
  } else {
    // Attempt to extract the newly created message id directly from the chat model
    try {
      if (c.pupPage && !c.pupPage.isClosed()) {
        wamid = await c.pupPage.evaluate((chatId: string) => {
          try {
            const chat = (globalThis as any).WWebJS.getChat(chatId, { getAsModel: false });
            if (chat && chat.msgs && chat.msgs.last) {
              const last = chat.msgs.last();
              return last?.id?._serialized || (typeof last?.id === 'string' ? last.id : null);
            }
          } catch {}
          return null;
        }, registered._serialized);
      }
    } catch {}
  }

  const finalId = wamid || `wwebjs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return { id: finalId };
}
