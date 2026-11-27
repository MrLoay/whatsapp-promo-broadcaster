/**
 * Cross-customer proxy audit. Each customer instance has its own database, so the app itself cannot see
 * whether two customers were given the same proxy. This reads several instance databases (read-only) and
 * reports any proxy endpoint (host:port) or proxy host shared between different instances.
 *
 *   node dist/cli/proxy-audit.js /opt/customer-a/data/app.db /opt/customer-b/data/app.db
 *
 * Exit code 1 if an exact host:port is shared between instances (a violation), 0 otherwise.
 */
import Database from 'better-sqlite3';
import { parseProxy } from '../services/proxies';

const paths = process.argv.slice(2);
if (paths.length < 2) {
  console.error('Usage: proxy-audit <instance-db-1> <instance-db-2> [more...]');
  process.exit(2);
}

type Use = { instance: string; account: string };
const byEndpoint = new Map<string, Use[]>();
const byHost = new Map<string, Use[]>();

for (const p of paths) {
  const db = new Database(p, { readonly: true, fileMustExist: true });
  const rows = db.prepare('SELECT id, account_name, proxy_url FROM accounts WHERE proxy_url IS NOT NULL').all() as {
    id: string; account_name: string | null; proxy_url: string;
  }[];
  for (const r of rows) {
    const parsed = parseProxy(r.proxy_url);
    if (!parsed) continue;
    const use: Use = { instance: p, account: r.account_name || r.id };
    (byEndpoint.get(parsed.key) ?? byEndpoint.set(parsed.key, []).get(parsed.key)!).push(use);
    (byHost.get(parsed.host) ?? byHost.set(parsed.host, []).get(parsed.host)!).push(use);
  }
  db.close();
}

const crossInstance = (uses: Use[]) => new Set(uses.map((u) => u.instance)).size > 1;
let violations = 0;

for (const [key, uses] of byEndpoint) {
  if (crossInstance(uses)) {
    violations++;
    console.log(`VIOLATION  ${key} is used by more than one customer:`);
    uses.forEach((u) => console.log(`             ${u.instance}  ->  ${u.account}`));
  }
}
for (const [host, uses] of byHost) {
  if (!crossInstance(uses)) continue;
  // An exact host:port clash was already reported above as a violation
  const exactShared = [...byEndpoint].some(([key, u]) => key.startsWith(host + ':') && crossInstance(u));
  if (exactShared) continue;
  console.log(`WARNING    host ${host} appears in more than one customer on different ports -- confirm with your provider these are different IPs:`);
  uses.forEach((u) => console.log(`             ${u.instance}  ->  ${u.account}`));
}

console.log(violations === 0 ? 'OK: no proxy endpoint is shared between customers.' : `${violations} shared proxy endpoint(s) found.`);
process.exit(violations === 0 ? 0 : 1);
