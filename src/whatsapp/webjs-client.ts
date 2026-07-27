import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import { config } from '../config';

let client: Client | null = null;
let readyPromise: Promise<Client> | null = null;

export type ConnectionStatus = 'idle' | 'qr' | 'authenticated' | 'ready' | 'error';

let connectionStatus: ConnectionStatus = 'idle';
let latestQr: string | null = null;
let lastError: string | null = null;

export function getConnectionState(): { status: ConnectionStatus; qr: string | null; error: string | null } {
  return { status: connectionStatus, qr: connectionStatus === 'qr' ? latestQr : null, error: lastError };
}

/**
 * Unofficial interim bridge (drives a real WhatsApp Web session via
 * Puppeteer) for use before a Meta WhatsApp Business account is approved.
 * Violates WhatsApp's ToS for bulk/automated sending -- carries real ban
 * risk. Switch WHATSAPP_PROVIDER back to cloud_api once verified.
 */
export function getWebJsClient(): Client {
  if (!client) {
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.whatsapp.webjsSessionPath }),
      puppeteer: { headless: true },
    });
  }
  return client;
}

export function ensureReady(): Promise<Client> {
  if (readyPromise) return readyPromise;

  const c = getWebJsClient();
  readyPromise = new Promise((resolve, reject) => {
    c.on('qr', (qr) => {
      connectionStatus = 'qr';
      latestQr = qr;
      console.log('\nScan this QR code in WhatsApp on your phone: Settings > Linked Devices > Link a Device\n');
      qrcodeTerminal.generate(qr, { small: true });
    });
    c.on('authenticated', () => {
      connectionStatus = 'authenticated';
      latestQr = null;
      console.log('whatsapp-web.js: authenticated, session saved for next time.');
    });
    c.on('auth_failure', (msg) => {
      connectionStatus = 'error';
      lastError = msg;
      reject(new Error(`whatsapp-web.js auth failure: ${msg}`));
    });
    c.on('ready', () => {
      connectionStatus = 'ready';
      latestQr = null;
      console.log('whatsapp-web.js: client ready.');
      resolve(c);
    });
    c.on('disconnected', () => {
      connectionStatus = 'idle';
    });
    c.initialize().catch((err) => {
      connectionStatus = 'error';
      lastError = err.message;
      reject(err);
    });
  });

  return readyPromise;
}

export async function sendTextMessage(toPhoneE164: string, text: string): Promise<{ id: string }> {
  if (config.dryRun) {
    const fakeId = `dryrun-webjs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[DRY_RUN web_js] Would send to ${toPhoneE164}:\n${text}`);
    return { id: fakeId };
  }

  const c = await ensureReady();
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
