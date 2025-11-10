# Flow402 Credits Monorepo

This workspace hosts everything needed for the Flow402 credits demo:

- `apps/web` – Next.js gateway + dashboard for managing credits and Supabase state.
- `apps/vendor-demo` – Express service that simulates a vendor integrating Flow402 and calling the gateway before serving their API.
- `packages/*` – Shared code (if any) consumed across apps.

## Quick Start

```bash
pnpm install
# start both apps in parallel
pnpm --filter web dev    # http://localhost:3000
pnpm --filter vendor-demo dev    # http://localhost:4000
```

Ensure you have Node 20+ and [`corepack`](https://nodejs.org/api/corepack.html) enabled so `pnpm` is available.

## Environment

Create a `.env` (or `.env.local` for Next.js) at the repo root with:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
FLOW402_TENANT_ID=0b7d4b0a-6e10-4db4-8571-2c74e07bcb35
NEXT_PUBLIC_FLOW402_TENANT_ID=0b7d4b0a-6e10-4db4-8571-2c74e07bcb35
VENDOR_DEMO_URL=http://localhost:4000
FLOW402_VENDOR_KEY=demo
FLOW402_SIGNING_SECRET=demo-signing-secret
DEMO_USER_ID=9c0383a1-0887-4c0f-98ca-cb71ffc4e76c
NEXT_PUBLIC_DEMO_USER_ID=9c0383a1-0887-4c0f-98ca-cb71ffc4e76c
GATEWAY_DEDUCT_URL=http://localhost:3000/api/gateway/deduct
DEMO_TOPUP_CREDITS=500
```

- The web app reads the Supabase credentials, the optional `DEMO_USER_ID`, and `VENDOR_DEMO_URL` for the simulation button.
- `FLOW402_TENANT_ID` (mirrored to `NEXT_PUBLIC_FLOW402_TENANT_ID`) scopes the Supabase `credits` + `tx_ledger` tables to the correct vendor project.
- `FLOW402_VENDOR_KEY` / `FLOW402_SIGNING_SECRET` come from the `tenants` row in Supabase and are used to HMAC-sign vendor → gateway requests.
- The vendor demo needs `GATEWAY_DEDUCT_URL` so it knows where to send credit checks.

## Demo Flow

1. Open `http://localhost:3000/dashboard`.
2. Use **Add Credit** to top up the Supabase balance (quick $ presets convert to credits at 1 USD = 100 credits, or leave it empty to demonstrate the auto top-up).
3. Click **Simulate paid API call** to hit the vendor service. The first attempt shows the 402 path when the balance is zero; the dashboard then auto top-ups (`DEMO_TOPUP_CREDITS`, default 500 credits = $5) and retries to show the happy-path response. Trace logs from both Vercel (Next) and DigitalOcean (vendor) render inline.
4. Use **Reset balance** to drop the credits back to zero, log a `manual_reset` entry, and rerun the simulation.

Behind the scenes the vendor demo middleware (`apps/vendor-demo/src/index.ts`) uses an `x-debug` header to send back log lines so the dashboard can display the full request chain.

## Deployment Checklist

| Service            | Host                                   | Important Env Vars                                                                                                          |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`         | Vercel                                 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VENDOR_DEMO_URL`, `DEMO_USER_ID` |
| `apps/vendor-demo` | DigitalOcean App Platform (or similar) | `GATEWAY_DEDUCT_URL`, `FLOW402_VENDOR_KEY`, `FLOW402_SIGNING_SECRET`                                                        |

Redeploy the vendor demo when `dist/index.js` changes. Redeploy the web app when API routes or the dashboard change.

## Repository Scripts

- `pnpm --filter web dev` – Next.js dev server (dashboard shows balances in credits plus USD equivalent).
- `pnpm --filter web build && pnpm --filter web start` – Production build & preview.
- `pnpm --filter vendor-demo dev` – Express server via `ts-node`.
- `pnpm --filter vendor-demo build && pnpm --filter vendor-demo start` – Production build & run.

## Troubleshooting

- **402 when you expect 200** – Check Supabase `credits` table balance and ensure the vendor demo is hitting the right `GATEWAY_DEDUCT_URL`.
- **Dashboard buttons failing** – Confirm `VENDOR_DEMO_URL` is set and reachable; inspect the trace logs rendered in the dashboard card.
- **Missing Supabase schema** – Execute `supabase/migrations/20251109-mvp-03-multi-tenant-credits.sql` in the Supabase SQL editor to provision the multi-tenant `credits`/`tx_ledger` tables plus the idempotent `increment_balance` and `deduct_balance` RPCs.

## Signed Gateway Verification

The `/api/gateway/deduct` route now rejects unsigned or stale vendor requests. Every call must include:

- `x-f402-key` – Vendor API key (slug/id also work) from the `tenants` table.
- `x-f402-body-sha` – Lowercase SHA-256 hash of the exact JSON body.
- `x-f402-sig` – `t=<unix>,v1=<hmac>` where `hmac = HMAC_SHA256(secret, t + "." + body)` using the vendor’s `signing_secret`. Skew greater than 5 minutes results in `401 invalid_signature`.

### Static Test Vector

```
body      = {"amount_credits":5,"ref":"demo-ref","userId":"9c0383a1-0887-4c0f-98ca-cb71ffc4e76c"}
secret    = demo-signing-secret
timestamp = 1729200000
body hash = 5a159b6e835fc4d107d0ffd630fe705c1a86c00ebf7d5dad7179ad912d249129
signature = 6f65904bd1173ac13d5a79d2c038d7db7908513bf50e41509d964ff2ac924ac5
header    = t=1729200000,v1=6f65904bd1173ac13d5a79d2c038d7db7908513bf50e41509d964ff2ac924ac5
```

### cURL Examples

Valid signed request (returns `200` or `402` depending on credits but never `401`):

```bash
BODY='{"amount_credits":5,"ref":"demo-ref","userId":"9c0383a1-0887-4c0f-98ca-cb71ffc4e76c"}'
TS=$(date +%s)
BODY_SHA=$(node -e "const crypto=require('node:crypto');process.stdout.write(crypto.createHash('sha256').update(process.argv[1]).digest('hex'))" "$BODY")
SIG=$(node -e "const crypto=require('node:crypto');const body=process.argv[1];const secret=process.argv[2];const ts=process.argv[3];process.stdout.write(crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex'))" "$BODY" "$FLOW402_SIGNING_SECRET" "$TS")

curl -i http://localhost:3000/api/gateway/deduct \
  -H "Content-Type: application/json" \
  -H "x-f402-key: $FLOW402_VENDOR_KEY" \
  -H "x-f402-body-sha: $BODY_SHA" \
  -H "x-f402-sig: t=$TS,v1=$SIG" \
  --data "$BODY"
```

Tampered request (`x-f402-body-sha` mismatch) returns `401 invalid_signature`:

```bash
curl -i http://localhost:3000/api/gateway/deduct \
  -H "Content-Type: application/json" \
  -H "x-f402-key: $FLOW402_VENDOR_KEY" \
  -H "x-f402-body-sha: deadbeef" \
  -H "x-f402-sig: t=$TS,v1=$SIG" \
  --data "$BODY"
```

All failures include a UUID `request_id` plus the rejection `reason` (`missing_body_hash`, `timestamp_out_of_window`, etc.) to aid debugging.

Happy demoing! Reach out if you need more automation or test fixtures. 
