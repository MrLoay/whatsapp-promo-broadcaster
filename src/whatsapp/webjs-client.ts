import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import { config } from '../config';

export type ConnectionStatus = 'idle' | 'qr' | 'authenticated' | 'ready' | 'error';

interface Session {
  client: Client | null;
  readyPromise: Promise<Client> | null;
  connectionStatus: ConnectionStatus;
  latestQr: string | null;
  lastError: string | null;
}

// Each dashboard account (owner) gets its own WhatsApp session -- separate
// linked device, separate LocalAuth data, separate connection state. This is
// what lets two unrelated boutiques share one login page/URL while each
// sending from its own WhatsApp number.
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

export function getConnectionState(owner: string): { status: ConnectionStatus; qr: string | null; error: string | null } {
  const s = getSession(owner);
  return { status: s.connectionStatus, qr: s.connectionStatus === 'qr' ? s.latestQr : null, error: s.lastError };
}

/**
 * Unofficial interim bridge (drives a real WhatsApp Web session via
 * Puppeteer) for use before a Meta WhatsApp Business account is approved.
 * Violates WhatsApp's ToS for bulk/automated sending -- carries real ban
 * risk.
 */
export function getWebJsClient(owner: string, proxyUrl?: string | null): Client {
  const s = getSession(owner);
  if (!s.client) {
    let activeCount = 0;
    for (const session of sessions.values()) {
      if (session.client) activeCount++;
    }
    if (activeCount >= config.whatsapp.maxConcurrentSessions) {
      throw new Error(`Max active WhatsApp sessions limit (${config.whatsapp.maxConcurrentSessions}) reached. Cannot launch more Chromium processes.`);
    }

    const puppeteerArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    if (proxyUrl) {
      puppeteerArgs.push(`--proxy-server=${proxyUrl}`);
    }

    s.client = new Client({
      // clientId keeps each owner's linked-device session under its own
      // subfolder of the same base path, so sessions never collide.
      authStrategy: new LocalAuth({ dataPath: config.whatsapp.webjsSessionPath, clientId: owner }),
      puppeteer: {
        headless: true,
        // Chrome refuses to start as root without this (common on VPS/container
        // deployments running as root): "Running as root without --no-sandbox
        // is not supported." This app only ever navigates to WhatsApp Web's own
        // origin, not arbitrary untrusted sites, so the reduced sandboxing is
        // an acceptable tradeoff here.
        args: puppeteerArgs,
      },
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
  s.client = null;
  s.readyPromise = null;
}

export function ensureReady(owner: string, proxyUrl?: string | null): Promise<Client> {
  const s = getSession(owner);
  if (s.readyPromise) return s.readyPromise;

  const c = getWebJsClient(owner, proxyUrl);
  s.readyPromise = new Promise((resolve, reject) => {
    c.on('qr', (qr) => {
      s.connectionStatus = 'qr';
      s.latestQr = qr;
      console.log(`\n[${owner}] Scan this QR code in WhatsApp on your phone: Settings > Linked Devices > Link a Device\n`);
      qrcodeTerminal.generate(qr, { small: true });
    });
    c.on('authenticated', () => {
      s.connectionStatus = 'authenticated';
      s.latestQr = null;
      console.log(`[${owner}] whatsapp-web.js: authenticated, session saved for next time.`);
    });
    c.on('auth_failure', (msg) => {
      s.connectionStatus = 'error';
      s.lastError = msg;
      resetForRetry(owner);
      reject(new Error(`whatsapp-web.js auth failure: ${msg}`));
    });
    c.on('ready', () => {
      s.connectionStatus = 'ready';
      s.latestQr = null;
      console.log(`[${owner}] whatsapp-web.js: client ready.`);
      resolve(c);
    });
    c.on('disconnected', () => {
      s.connectionStatus = 'idle';
      resetForRetry(owner);
    });
    c.initialize().catch((err) => {
      s.connectionStatus = 'error';
      s.lastError = err.message;
      resetForRetry(owner);
      reject(err);
    });
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

  if (c) {
    try {
      await c.logout();
    } catch {
      // Best-effort -- state is already reset above regardless of whether the
      // in-progress session could be gracefully logged out.
    }
    try {
      if (c.pupBrowser) {
        await c.pupBrowser.close();
      }
    } catch {
      /* process may already be closed */
    }
    try {
      await c.destroy();
    } catch {
      /* already torn down */
    }
  }
}

export async function sendTextMessage(owner: string, toPhoneE164: string, text: string): Promise<{ id: string }> {
  if (config.dryRun) {
    const fakeId = `dryrun-webjs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[DRY_RUN web_js][${owner}] Would send to ${toPhoneE164}:\n${text}`);
    return { id: fakeId };
  }

  const c = await ensureReady(owner);
  const rawNumber = toPhoneE164.replace(/^\+/, '');

  const registered = await c.getNumberId(rawNumber);
  if (!registered) {
    throw new Error(`${toPhoneE164} is not a registered WhatsApp number (or is unreachable) -- skipped.`);
  }

  const message: Message = await c.sendMessage(registered._serialized, text);
  if (!message?.id) {
    // Known whatsapp-web.js quirk: sometimes this means the message still
    // went through and only the confirmation object failed to build --
    // but it's NOT reliable (confirmed: two identical failures here, one
    // delivered and one didn't). Fail loudly rather than guess, so a human
    // checks the phone and decides whether to resend via a new campaign.
    throw new Error(
      `whatsapp-web.js returned no message id for ${toPhoneE164} -- the message MAY or MAY NOT have been ` +
        'delivered (this is unreliable). Check WhatsApp on your phone to confirm before resending.'
    );
  }
  return { id: message.id._serialized };
}
