# Flow402 Web Dashboard

// Current top-up & 402 behaviour (as of 2025-11-13)

- **Permit2 / approvals / setup** – The Flow402Treasury contract in `flow402-escrow/src/Flow402Treasury.sol` exposes three deposit paths (`deposit`, `depositWithPermit`, `depositWithPermit2`) and ships its ABI via `packages/contracts/Flow402Treasury.json`, but the web app currently only uses the legacy ERC-20 `approve + deposit` flow (`apps/web/src/lib/treasury-actions.ts`). `ApproveClient` runs entirely client-side: it parses `amount` + `spendingLimit`, checks allowance with `checkAllowance`, calls `approveUSDC`, then `deposit`, and finally redirects to `/api/topup/credit`. There is no persisted Permit2 permit yet, so the “one-time setup” is simply granting approval directly to the Treasury.
- **Treasury integration** – `/approve` submits an on-chain `deposit(amount, spendingLimit)` transaction (vendor parameter unused) and the `/api/topup/credit` route confirms the `UserDeposit` event before minting credits via Supabase `increment_balance` (`p_kind = "credit"`, ref `treasury_topup_<tx>`). Credits stay pegged at 100 credits == 1 USDC; conversions happen inside `ApproveClient`/`topup/credit`.
- **402 / gateway loop** – `/api/gateway/deduct` validates HMAC headers, enforces idempotency via `IdempotencyStore`, and (through `Flow402Dal`) debits balances keyed by `(tenant_id, user_id)` if enough credits exist; otherwise it replies `402` with a `topup_url`. The vendor demo middleware (`apps/vendor-demo/src/index.ts`) simply propagates that 402 to callers. For storytelling today, `/api/demo/charge` handles retries: upon the first 402 it directly mints `DEMO_TOPUP_CREDITS` via `increment_balance`, logs the auto top-up, and replays the vendor call. `/api/topup/reset` zeroes the demo balance (and logs a `manual_reset`) but does not touch on-chain state.
- **Credits + Supabase** – `supabase/migrations/20251109-mvp-03-multi-tenant-credits.sql` provisions `tenants`, `credits`, `tx_ledger`, plus the `increment_balance`/`deduct_balance` RPCs that enforce per-tenant accounting. `Flow402Dal` (apps/web/src/lib/dal.ts) is the single entry point the API routes use: `ensureVendorUser`, `getBalance`, `incrementBalance` (credit/debit/fee) all live there. `/api/topup/mock` and `/api/demo/charge` currently bypass the Treasury and talk straight to those RPCs with the service role key.

// Auto-topup (treasury-first) design

1. **One-time setup** – Keep `/approve` as the UX entry point but document that “auto-topup ready” = wallet connected, allowance granted (via `approveUSDC` today, swappable with a Permit2 helper later), and a spending limit selected. The same page can be deep-linked from the dashboard so users mint an optional seed deposit and establish a healthy allowance/spend limit in one go.
2. **Feature flag & safety rails** – Introduce `AUTO_TOPUP_ENABLED`/`NEXT_PUBLIC_AUTO_TOPUP_ENABLED` plus `NEXT_PUBLIC_AUTO_TOPUP_MAX_USDC` to opt into the real on-chain path. When the flag is off we keep the legacy `/api/demo/charge` behaviour (Supabase-only refill). When it is on, `/api/demo/charge` stops mutating Supabase directly and, on a 402, returns `{ auto_topup_required: true, amount_credits: DEMO_TOPUP_CREDITS }`. The dashboard tracks how much USDC it has auto-pulled this session and refuses to exceed the configured cap.
3. **Client-side auto-topup helper** – The dashboard already owns the wallet context via `<AppProviders>`. We’ll add a small helper that, on demand, (a) ensures the wallet is connected, (b) checks allowance with `checkAllowance` and calls `approveUSDC` if the requested deposit exceeds it, (c) submits the on-chain `depositFor` (currently aliased to `deposit`) with a conservative spending limit multiplier, (d) POSTs the resulting `tx` hash to `/api/topup/credit`, and (e) re-runs `/api/demo/charge`. All of this rides existing helpers, so swapping in `depositWithPermit2` once a permit helper exists will only touch this helper. Low-balance detection (balance returned by Supabase) can call the same helper before hitting the vendor demo to hide the 402 entirely once the setup is complete.

This Next.js app powers the Flow402 gateway and demo dashboard. It exposes the credit-deduction API that the vendor demo service calls, plus a small UI to top up, reset, and trigger simulated paid requests end-to-end.

## Environment Variables

| Key | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL used by the client and API routes. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key for browser interactions. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (server) | Service role key used by API routes (`/api/gateway/deduct`, `/api/topup/mock`, `/api/topup/reset`). Never expose this to the browser. |
| `VENDOR_DEMO_URL` | ✅ | Base URL for the vendor demo deployment (e.g. `https://flow402-credits-vendor-demo-xxxxx.ondigitalocean.app`). |
| `FLOW402_TENANT_ID` | ✅ | Tenant UUID that scopes credits + ledger RPC calls. Set to the row inside the `tenants` table created by the Supabase migration. |
| `NEXT_PUBLIC_FLOW402_TENANT_ID` | ✅ | Same UUID exposed to the dashboard so the anon Supabase client only reads data for that tenant. |
| `DEMO_USER_ID` | optional | UUID to show on the dashboard. Defaults to `9c0383a1-0887-4c0f-98ca-cb71ffc4e76c`. |
| `NEXT_PUBLIC_DEMO_USER_ID` | optional | Browser-friendly copy of `DEMO_USER_ID` so the dashboard can talk to Supabase with the anon key. |
| `DEMO_TOPUP_CREDITS` | optional | Credits to auto top-up when the demo detects a 402. Defaults to `500` (i.e. $5). |
| `AUTO_TOPUP_ENABLED` | optional | When `true`, `/api/demo/charge` defers 402 recovery to the client so the Treasury path can run. Defaults to `false`. |
| `NEXT_PUBLIC_AUTO_TOPUP_ENABLED` | optional | Client-side flag that toggles the wallet-powered auto top-up helper on the dashboard. Defaults to `false`. |
| `NEXT_PUBLIC_AUTO_TOPUP_CREDITS` | optional | How many credits to deposit per automatic run (defaults to `500`). |
| `NEXT_PUBLIC_AUTO_TOPUP_MAX_USDC` | optional | Session cap (in USDC) for automatic deposits, default `25` (i.e. 2,500 credits). |
| `NEXT_PUBLIC_AUTO_TOPUP_SPENDING_LIMIT_MULTIPLIER` | optional | Multiplier applied to each deposit amount when setting Treasury spending limits + allowances (default `10`). |

### Base Sepolia Fork Profile

- Running `./script/start-base-fork.sh` + `./script/base-fork-cycle.sh` in `flow402-escrow` deploys contracts onto the fork and writes `packages/contracts/deployment.base-fork.json` (addresses + RPC) plus `apps/web/.env.base-fork` (sets `NEXT_PUBLIC_CHAIN_ENV=base-fork`).  
- Start the dashboard against that fork with `pnpm --filter web dev:fork`. That script exports `FLOW402_ENV_FILE=.env.base-fork` so `next.config.ts` layers `.env.base-fork` on top of the shared `.env` + `.env.local`.  
- Wallet hooks (`wagmi`) and server routes load addresses from `deployment.base-fork.json`, so the entire stack now points to the forked Base Sepolia node at `http://127.0.0.1:8545`. Run the regular `pnpm --filter web dev` to switch back to the local Anvil deployment.

Add these to `.env.local` during development and to your Vercel or hosting project for production.

### Supabase Schema

Apply `supabase/migrations/20251109-mvp-03-multi-tenant-credits.sql` (via the Supabase SQL editor or `supabase db push`) before running the dashboard. It provisions:

- `tenants` – catalog of Flow402 vendor projects (a seeded `demo` row matches the default `FLOW402_TENANT_ID`).
- `credits` / `tx_ledger` – tenant-scoped tables for balances + ledger history.
- `increment_balance` / `deduct_balance` – idempotent RPC helpers that keep ledger + balance mutations atomic.

## Running Locally

```bash
pnpm install
pnpm --filter web dev
```

Visit [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to use the demo controls.

## Dashboard Features

- **Add Credit** – Quick $ presets and a manual input convert USD into credits (1 USD = 100 credits) and call `/api/topup/mock` to simulate the purchase.
- **Reset Balance** – Calls `/api/topup/reset` to zero the demo user’s balance (if a balance exists) and record a ledger entry tagged with a `manual_reset` reference.
- **Simulate Paid API Call** – Pings the vendor demo (`/demo/screenshot`) with debugging enabled, which in turn hits `/api/gateway/deduct`. The first call shows the live 402 path if the balance is empty; the route then auto top-ups using the service role key and retries so you can narrate “insufficient funds → top-up → success” in one click. Trace logs from both services render in the dashboard.
- **Recent Transactions** – Displays the latest activity from `tx_ledger` in credits.

## On-chain Treasury Top-up

When running against a local Anvil deployment, the `/approve` page lets a wallet holder mint credits directly from the Flow402 Treasury:

```
/approve?amount=10&userId=<uuid>&spendingLimit=100
```

- `amount` is denominated in USDC (base 10) and is scaled to 6 decimals before calling `Treasury.deposit(amount, spendingLimit)`.
- `spendingLimit` is optional and defaults to `amount * 10` if omitted.
- No vendor parameter is required—deposits fill a user’s general credit wallet and vendors settle later via `batchSettle`.
- After the wallet signs the `approve` + `deposit` transactions, the page redirects to `/api/topup/credit?tx=<hash>&userId=<uuid>` which validates the `UserDeposit` event and calls Supabase’s `increment_balance` RPC.

## Auto Top-up Flow (beta)

- **Enable it** by setting `AUTO_TOPUP_ENABLED=true` (Next API defers 402 recovery to the client) and `NEXT_PUBLIC_AUTO_TOPUP_ENABLED=true` (renders the wallet helper). Adjust `NEXT_PUBLIC_AUTO_TOPUP_CREDITS` (credits per refill), `NEXT_PUBLIC_AUTO_TOPUP_MAX_USDC` (session cap), and `NEXT_PUBLIC_AUTO_TOPUP_SPENDING_LIMIT_MULTIPLIER` (how aggressive the spending limit should be) as needed. Defaults: 500 credits per run, $25 cap, 10× limit.
- **One-time setup:** hit `/approve?amount=<usd>&userId=<uuid>&spendingLimit=<usd>` from the dashboard banner. That flow reuses `approveUSDC` + `deposit`, so once the allowance + Treasury spending limit cover your chosen cap you won’t need to revisit it unless you raise the limit.
- **Runtime behaviour:** when `/api/demo/charge` sees the vendor return HTTP 402 it now responds with `{ auto_topup_required: true }` instead of mutating Supabase. The dashboard immediately (a) ensures the wallet is connected, (b) checks allowance via `checkAllowance` and runs `approveUSDC` if needed, (c) calls `depositFor` with the configured spending limit multiplier, (d) POSTs the transaction hash to `/api/topup/credit`, and (e) replays `/api/demo/charge`. If the balance is already below the “remaining credits” threshold you can also press “Mint … credits now” in the banner to pre-fund before hitting the vendor demo.
- **Safety rails:** every session tracks how many credits have been minted automatically and refuses to exceed `NEXT_PUBLIC_AUTO_TOPUP_MAX_USDC`. The helper surfaces wallet errors (no connector, signature rejected, etc.) in-line so you can revert to the existing mock `/api/topup/mock` buttons if needed.
- **Limitations:** still uses ERC-20 approvals under the hood (a Permit2 helper can replace `approveUSDC`/`depositFor` later), and automatic deposits rely on the browser tab staying open so the wallet can prompt for signatures. Some ERC-20s require zeroing allowances before increasing them; the mock USDC used in the demo does not enforce that guard.

## Deployment Notes

1. Deploy the web app (gateway + dashboard) to Vercel.
2. Deploy the vendor demo (`apps/vendor-demo`) to DigitalOcean or another host, setting `GATEWAY_DEDUCT_URL` to your Vercel `/api/gateway/deduct` endpoint.
3. In Vercel, set `VENDOR_DEMO_URL` so the dashboard knows where to send the simulated API call.
4. Use the dashboard buttons to walk through a top-up, a successful deduction, and a reset—all logs surface inline for fast storytelling.
