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
VENDOR_DEMO_URL=http://localhost:4000
DEMO_USER_ID=9c0383a1-0887-4c0f-98ca-cb71ffc4e76c
GATEWAY_DEDUCT_URL=http://localhost:3000/api/gateway/deduct
DEMO_TOPUP_CREDITS=500
```

- The web app reads the Supabase credentials, the optional `DEMO_USER_ID`, and `VENDOR_DEMO_URL` for the simulation button.
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
| `apps/vendor-demo` | DigitalOcean App Platform (or similar) | `GATEWAY_DEDUCT_URL` (pointing to Vercel `/api/gateway/deduct`)                                                             |

Redeploy the vendor demo when `dist/index.js` changes. Redeploy the web app when API routes or the dashboard change.

## Repository Scripts

- `pnpm --filter web dev` – Next.js dev server (dashboard shows balances in credits plus USD equivalent).
- `pnpm --filter web build && pnpm --filter web start` – Production build & preview.
- `pnpm --filter vendor-demo dev` – Express server via `ts-node`.
- `pnpm --filter vendor-demo build && pnpm --filter vendor-demo start` – Production build & run.

## Troubleshooting

- **402 when you expect 200** – Check Supabase `credits` table balance and ensure the vendor demo is hitting the right `GATEWAY_DEDUCT_URL`.
- **Dashboard buttons failing** – Confirm `VENDOR_DEMO_URL` is set and reachable; inspect the trace logs rendered in the dashboard card.
- **Missing Supabase schema** – Run migrations/SQL to create `credits` and `tx_ledger` tables plus the `increment_balance` RPC used by the mock top-up route.

Happy demoing! Reach out if you need more automation or test fixtures. 
