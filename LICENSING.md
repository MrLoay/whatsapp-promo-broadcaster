# Customer licensing (SaaS model)

Each customer gets their **own copy** of the system (own folder, database, WhatsApp sessions, port and PM2
process) with `LICENSE_ENFORCE=true`. We provide the software, dashboard, sending functions, fixes and
support. The customer brings their own WhatsApp accounts, SIM cards and proxies.

## What `LICENSE_ENFORCE=true` changes

| Area | Behaviour |
|---|---|
| License | One license per copy: customer name, **max accounts**, **expiry date**. Stored in the database. |
| Changing it | **Only on the server**, with `node dist/cli/license.js`. There is no dashboard/API to change it, so a customer cannot raise their own limit. Every change is logged. |
| Account limit | Adding or re-activating a WhatsApp account beyond the limit is refused. |
| Expiry | Valid through the end of the expiry day (Malaysia time). After that: broadcasts and new connections are blocked, a running broadcast stops, and sessions are not started on restart. History and CSV exports stay available. |
| Proxies | Every account **must** have its own proxy; no two accounts in a copy may share the same `host:port`. The dashboard only ever shows `protocol://host:port` (never the password). |
| Billing | Per-message credits are switched off (no deduction, no credit display). |
| Dashboard | A status bar shows customer, accounts used/allowed and days left (amber when full or <= 14 days, red when expired). |

A copy **without** `LICENSE_ENFORCE=true` behaves exactly as before (the original system).

## Create a customer copy

```bash
cd /opt/whatsapp-broadcast
scripts/new-instance.sh customer-a 3011 "Customer A" 20 2027-01-31 customera 'ChangeMe123'
scripts/new-instance.sh customer-b 3012 "Customer B" 40 2027-01-31 customerb 'ChangeMe456'
# add "dry" as a final argument for a trial copy that never connects real WhatsApp sessions
```

Then give each customer an HTTPS address (nginx server block proxying to `127.0.0.1:<port>`).

## Manage a license (run inside the customer's folder, e.g. `/opt/whatsapp-customer-a`)

```bash
node dist/cli/license.js show                                   # status
node dist/cli/license.js set --customer "Customer A" --max 30 --expires 2027-06-30   # upgrade after manual confirmation
node dist/cli/license.js extend --days 30                       # renew (adds to current expiry, or from today if expired)
node dist/cli/license.js log                                    # audit trail
```

Changes apply immediately. If a license had already expired when the app last started, restart it
(`pm2 restart whatsapp-customer-a`) so the WhatsApp sessions reconnect.

## Keep proxies separate between customers

Each customer must use a **separate proxy pool**. The app enforces "no sharing" inside one copy; across
copies run:

```bash
node dist/cli/proxy-audit.js /opt/whatsapp-customer-a/data/app.db /opt/whatsapp-customer-b/data/app.db
```

It fails (exit code 1) if any `host:port` is used by two customers and warns if the same host appears
on different ports (confirm with the provider that those are different IPs). The software cannot see the
real IP behind a proxy address, so buy dedicated IPs.

## Notes

- Updating the software: pull + build once in `/opt/whatsapp-broadcast`, then copy `dist/` (and `public/`) to
  each customer folder and `pm2 restart` it, one at a time.
- Per-customer isolation is by separate process and database; it does not defend against someone with root on the server.
- WhatsApp's terms forbid this kind of automation; the license contract should place that risk on the customer.
