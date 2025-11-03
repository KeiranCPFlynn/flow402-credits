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

Add these to `.env.local` during development and to your Vercel or hosting project for production.

## Running Locally

```bash
pnpm install
pnpm --filter web dev
```

Visit [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to use the demo controls.

## Dashboard Features

- **Add Credit** – Calls `/api/topup/mock` to simulate purchasing credits.
- **Reset Balance** – Calls `/api/topup/reset` to zero the demo user’s balance and record a `reset` ledger entry.
- **Simulate Paid API Call** – Pings the vendor demo (`/demo/screenshot`) with debugging enabled, which in turn hits `/api/gateway/deduct`. Response JSON and trace logs from both services render in the dashboard so you can narrate the YC demo without opening a terminal.
- **Recent Transactions** – Displays the latest activity from `tx_ledger`.

## Deployment Notes

1. Deploy the web app (gateway + dashboard) to Vercel.
2. Deploy the vendor demo (`apps/vendor-demo`) to DigitalOcean or another host, setting `GATEWAY_DEDUCT_URL` to your Vercel `/api/gateway/deduct` endpoint.
3. In Vercel, set `VENDOR_DEMO_URL` so the dashboard knows where to send the simulated API call.
4. Use the dashboard buttons to walk through a top-up, a successful deduction, and a reset—all logs surface inline for fast storytelling.
