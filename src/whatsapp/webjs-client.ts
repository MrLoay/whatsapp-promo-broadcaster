import fs from 'fs';
import path from 'path';
import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { config } from '../config';

export type ConnectionStatus = 'idle' | 'connecting' | 'qr' | 'authenticated' | 'ready' | 'error';

interface Session {
  client: Client | null;
  readyPromise: Promise<Client> | null;
  connectionStatus: ConnectionStatus;
  latestQr: string | null;
  latestQrDataUrl: string | null;
  lastError: string | null;
  cleanup?: () => void;
}

// Each dashboard account (owner) gets its own WhatsApp session
const sessions = new Map<string, Session>();

function getSession(owner: string): Session {
  let session = sessions.get(owner);
  if (!session) {
    session = { client: null, readyPromise: null, connectionStatus: 'idle', latestQr: null, latestQrDataUrl: null, lastError: null };
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
  qrDataUrl: string | null;
  error: string | null;
  phone: string | null;
  pushname: string | null;
} {
  const s = getSession(owner);
  const isReady = s.connectionStatus === 'ready';
  const qr = (!isReady && s.latestQr) ? s.latestQr : null;
  const qrDataUrl = (!isReady && s.latestQrDataUrl) ? s.latestQrDataUrl : null;
  const phone = s.client?.info?.wid?.user ? `+${s.client.info.wid.user}` : null;
  const pushname = s.client?.info?.pushname || null;
  return { status: s.connectionStatus, qr, qrDataUrl, error: s.lastError, phone, pushname };
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
      '--no-first-run',
      '--no-zygote',
      '--renderer-process-limit=1',
      '--disable-site-isolation-trials',
      '--disable-accelerated-2d-canvas',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--js-flags=--max-old-space-size=96',
      '--disk-cache-size=5242880',
      '--media-cache-size=5242880',
      '--disable-audio-output',
      '--window-size=800,600',
      '--disable-notifications',
      '--password-store=basic',
      '--use-mock-keychain'
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

    // Clean up any stale Chromium Singleton locks left from previous crashes or migrations
    try {
      const sessionDir = path.join(config.whatsapp.webjsSessionPath, 'session-' + safeClientId);
      if (fs.existsSync(sessionDir)) {
        ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach((lockFile) => {
          const lockPath = path.join(sessionDir, lockFile);
          if (fs.existsSync(lockPath)) {
            try { fs.unlinkSync(lockPath); } catch {}
          }
        });
      }
    } catch {}

    s.client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.whatsapp.webjsSessionPath, clientId: safeClientId }),
      qrMaxRetries: 15,
      authTimeoutMs: 90000,
      puppeteer: {
        headless: true,
        args: puppeteerArgs,
        timeout: 90000,
        protocolTimeout: 180000
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
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
    try { s.cleanup(); } catch {}
    s.cleanup = undefined;
  }
  s.client = null;
  s.readyPromise = null;
  s.latestQr = null; // Wipe stale QR on reset!
  s.latestQrDataUrl = null;
  if (oldClient) {
    try {
      if (oldClient.pupBrowser) {
        const proc = oldClient.pupBrowser.process();
        if (proc && proc.pid) {
          try { process.kill(proc.pid, 'SIGKILL'); } catch {}
        }
        oldClient.pupBrowser.close().catch(() => {});
      }
    } catch {}
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
      c.on('qr', async (qr) => {
        s.connectionStatus = 'qr';
        s.latestQr = qr;
        s.lastError = null;
        try {
          s.latestQrDataUrl = await QRCode.toDataURL(qr, { width: 240, margin: 1 });
        } catch {
          s.latestQrDataUrl = null;
        }
        console.log(`\n[${owner}] Scan this QR code in WhatsApp on your phone: Settings > Linked Devices > Link a Device\n`);
        qrcodeTerminal.generate(qr, { small: true });
      });

      c.on('authenticated', () => {
        s.connectionStatus = 'authenticated';
        s.latestQr = null;
        s.latestQrDataUrl = null;
        s.lastError = null;
        console.log(`[${owner}] whatsapp-web.js: authenticated, session saved for next time.`);
      });
      c.on('auth_failure', (msg) => {
        s.connectionStatus = 'error';
        s.lastError = msg;
        s.latestQr = null;
        s.latestQrDataUrl = null;
        resetForRetry(owner);
        reject(new Error(`whatsapp-web.js auth failure: ${msg}`));
      });
      c.on('ready', () => {
        s.connectionStatus = 'ready';
        s.latestQr = null;
        s.latestQrDataUrl = null;
        s.lastError = null;
        console.log(`[${owner}] whatsapp-web.js: client ready.`);
        resolve(c);
      });
      c.on('disconnected', () => {
        s.connectionStatus = 'idle';
        s.latestQr = null;
        s.latestQrDataUrl = null;
        resetForRetry(owner);
      });
      c.initialize().catch((err) => {
        s.connectionStatus = 'error';
        s.lastError = err.message;
        s.latestQr = null;
        s.latestQrDataUrl = null;
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
  s.latestQrDataUrl = null;
  s.lastError = null;
  if (s.cleanup) {
    s.cleanup();
    s.cleanup = undefined;
  }
  
  if (c) {
    const withTimeout = (promise: Promise<any>, ms: number) =>
      Promise.race([promise, new Promise((res) => setTimeout(res, ms))]);

    try {
      await withTimeout(c.logout(), 1000);
    } catch {}
    try {
      if (c.pupBrowser) {
        const proc = c.pupBrowser.process();
        if (proc && proc.pid) {
          try { process.kill(proc.pid, 'SIGKILL'); } catch {}
        }
        await withTimeout(c.pupBrowser.close(), 1000);
      }
    } catch {}
    try {
      await withTimeout(c.destroy(), 1000);
    } catch {}
  }
}

/** 
 * Safely destroys all active sessions and kills their browser processes.
 * Essential for preventing zombie Chromium processes on server restart.
 */
export async function destroyAll(): Promise<void> {
  const promises = [];
  for (const owner of sessions.keys()) {
    const s = sessions.get(owner);
    if (s && s.client) {
      console.log(`[Graceful Shutdown] Tearing down WhatsApp session for ${owner}...`);
      promises.push(
        Promise.resolve().then(async () => {
          try {
            if (s.client?.pupBrowser) {
              const proc = s.client.pupBrowser.process();
              if (proc && proc.pid) {
                try { process.kill(proc.pid, 'SIGKILL'); } catch {}
              }
              await s.client.pupBrowser.close().catch(() => {});
            }
          } catch {}
          try {
            await s.client?.destroy().catch(() => {});
          } catch {}
          if (s.cleanup) {
            try { s.cleanup(); } catch {}
          }
        })
      );
    }
  }
  await Promise.all(promises);
  sessions.clear();
}

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
      const b64data = fs.readFileSync(mediaPath, { encoding: 'base64' });
      let finalMime = mediaMimeType;

      // If mimeType not provided or generic, detect via extension or file magic bytes
      if (!finalMime || finalMime === 'application/octet-stream') {
        const ext = path.extname(mediaPath).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') finalMime = 'image/jpeg';
        else if (ext === '.png') finalMime = 'image/png';
        else if (ext === '.webp') finalMime = 'image/webp';
        else if (ext === '.gif') finalMime = 'image/gif';
        else if (ext === '.mp4') finalMime = 'video/mp4';
        else if (ext === '.pdf') finalMime = 'application/pdf';
        else {
          // Detect by magic bytes
          const buf = fs.readFileSync(mediaPath);
          if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
            finalMime = 'image/jpeg';
          } else if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
            finalMime = 'image/png';
          } else if (buf.length >= 12 && buf.toString('utf8', 0, 4) === 'RIFF' && buf.toString('utf8', 8, 12) === 'WEBP') {
            finalMime = 'image/webp';
          } else {
            finalMime = 'image/jpeg';
          }
        }
      }

      const fileExt = finalMime.includes('png') ? 'png' : finalMime.includes('webp') ? 'webp' : 'jpg';
      const filename = path.basename(mediaPath).includes('.')
        ? path.basename(mediaPath)
        : `photo_${Date.now()}.${fileExt}`;

      messageContent = new MessageMedia(finalMime, b64data, filename);
      if (text) {
        options.caption = text;
      }
    } catch (err) {
      console.error(`[${owner}] Failed to load media from ${mediaPath}:`, err);
      // Fallback to text only if media fails
      messageContent = text;
    }
  }

  if (!c.pupPage || c.pupPage.isClosed()) {
    throw new Error(`WhatsApp page for ${owner} is closed or unreachable.`);
  }

  // Ensure WWebJS helper module is alive and patch media memoize getter issue
  try {
    await c.pupPage.evaluate(() => {
      const w = globalThis as any;
      if (!w.WWebJS) return false;
      if (!w.WWebJS._mediaMemoizePatched) {
        w.WWebJS._mediaMemoizePatched = true;
        
        // Patch processMediaData to strip __x_id
        const origProcess = w.WWebJS.processMediaData;
        if (origProcess) {
          w.WWebJS.processMediaData = async function(...args: any[]) {
            const res = await origProcess.apply(this, args);
            if (res) {
              try { delete res.__x_id; } catch {}
              if (res.toJSON) {
                const origToJSON = res.toJSON;
                res.toJSON = function() {
                  const json = origToJSON.apply(this, arguments);
                  if (json) {
                    try { delete json.__x_id; } catch {}
                  }
                  return json;
                };
              }
            }
            return res;
          };
        }

        // Patch sendMessage to delete message.__x_id
        const origSend = w.WWebJS.sendMessage;
        if (origSend) {
          w.WWebJS.sendMessage = async function(chat: any, content: any, opts: any = {}) {
            if (opts && opts.media) {
              try { delete opts.media.__x_id; } catch {}
            }
            return origSend.apply(this, arguments);
          };
        }
      }
      return true;
    });
  } catch {}

  let message: any = null;
  try {
    message = await c.sendMessage(registered._serialized, messageContent, options);
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('Execution context was destroyed') || errMsg.includes('Target closed') || errMsg.includes('Session closed')) {
      throw new Error(`Account ${owner} session connection dropped: ${errMsg}`);
    }
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
            const chat = (globalThis as any).WWebJS?.getChat(chatId, { getAsModel: false });
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
