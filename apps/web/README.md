# Flow402 Web Dashboard

This Next.js app powers the Flow402 gateway and demo dashboard. It exposes the credit-deduction API that the vendor demo service calls, plus a small UI to top up, reset, and trigger simulated paid requests end-to-end.

## Environment Variables

| Key | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL used by the client and API routes. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key for browser interactions. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (server) | Service role key used by API routes (`/api/gateway/deduct`, `/api/topup/mock`, `/api/topup/reset`). Never expose this to the browser. |
| `VENDOR_DEMO_URL` | ✅ | Base URL for the vendor demo deployment (e.g. `https://flow402-credits-vendor-demo-xxxxx.ondigitalocean.app`). |
| `DEMO_USER_ID` | optional | UUID to show on the dashboard. Defaults to `9c0383a1-0887-4c0f-98ca-cb71ffc4e76c`. |
| `DEMO_TOPUP_CENTS` | optional | Amount (in cents) to auto top-up when the demo detects a 402. Defaults to `500` (i.e. $5). |

Add these to `.env.local` during development and to your Vercel or hosting project for production.

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

## Deployment Notes

1. Deploy the web app (gateway + dashboard) to Vercel.
2. Deploy the vendor demo (`apps/vendor-demo`) to DigitalOcean or another host, setting `GATEWAY_DEDUCT_URL` to your Vercel `/api/gateway/deduct` endpoint.
3. In Vercel, set `VENDOR_DEMO_URL` so the dashboard knows where to send the simulated API call.
4. Use the dashboard buttons to walk through a top-up, a successful deduction, and a reset—all logs surface inline for fast storytelling.
