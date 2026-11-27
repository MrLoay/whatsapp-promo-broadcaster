import type Database from 'better-sqlite3';

/** Thrown for an invalid or already-used proxy (maps to HTTP 400). */
export class ProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyError';
  }
}

export interface ParsedProxy {
  protocol: string;
  host: string;
  port: string;
  hasCredentials: boolean;
  /** Identity of the IP endpoint: two accounts may never share it. */
  key: string;
}

const ALLOWED_PROTOCOLS = ['http:', 'https:', 'socks4:', 'socks5:'];

export function parseProxy(raw: string): ParsedProxy | null {
  try {
    const u = new URL(raw.trim());
    if (!ALLOWED_PROTOCOLS.includes(u.protocol) || !u.hostname || !u.port) return null;
    return {
      protocol: u.protocol,
      host: u.hostname.toLowerCase(),
      port: u.port,
      hasCredentials: Boolean(u.username || u.password),
      key: `${u.hostname.toLowerCase()}:${u.port}`,
    };
  } catch {
    return null;
  }
}

/** protocol://host:port -- safe to show in the dashboard and logs (never includes credentials). */
export function redactProxy(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = parseProxy(raw);
  return p ? `${p.protocol}//${p.host}:${p.port}` : '[invalid proxy]';
}

/**
 * Checks the proxy an account will use: it must exist, be well formed, and not already belong to a
 * different account. (Host + port identifies the endpoint; two accounts on the same one share an IP.)
 */
export function validateAccountProxy(db: Database.Database, accountId: string, proxyUrl: string | null | undefined): void {
  if (!proxyUrl) {
    throw new ProxyError('A dedicated proxy is required for every WhatsApp account.');
  }
  const parsed = parseProxy(proxyUrl);
  if (!parsed) {
    throw new ProxyError('Invalid proxy. Use the form http://user:pass@host:port (or socks5://...).');
  }
  const others = db
    .prepare('SELECT id, account_name, proxy_url FROM accounts WHERE id != ? AND proxy_url IS NOT NULL')
    .all(accountId) as { id: string; account_name: string | null; proxy_url: string }[];
  for (const o of others) {
    if (parseProxy(o.proxy_url)?.key === parsed.key) {
      throw new ProxyError(
        `This proxy (${parsed.host}:${parsed.port}) is already used by account "${o.account_name || o.id}". Each account needs its own proxy.`
      );
    }
  }
}
