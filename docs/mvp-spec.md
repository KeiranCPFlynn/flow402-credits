# Flow402 MVP Spec

Freezing the minimum viable product contract between a Flow402-enabled vendor API, the Flow402 gateway (Next.js app), and any automated agent invoking that vendor API. This codifies the current implementation that already ships in `apps/web` and `apps/vendor-demo` so future changes remain backward compatible.

## Actors and Surfaces

- **Agent / client** – hits the vendor API and brings an authenticated user identity.
- **Vendor API** – attaches the Flow402 middleware (see `apps/vendor-demo/src/index.ts`) that calls the Flow402 gateway before fulfilling the request.
- **Flow402 gateway** – `/api/gateway/deduct` (in `apps/web`) that enforces balances stored in Supabase (`credits` table).

## Credits and Currency Unit

- Ledger columns are named `balance_cents`, but **1 credit == 1 USDC cent ($0.01)**. This is the unit every API talks about (`amount_credits`, `price_credits`, `balance_cents`).
- Credits are integers; we round down on deduction requests and reject non-positive values.
- Gateway responses translate credits to USD only for human-facing logs (see dashboard), never inside the API contract.

## Header Contract

| Header | Direction | Required | Description |
| --- | --- | --- | --- |
| `x-user-id` | Agent → Vendor | ✅ | Canonical UUID for the caller. The vendor must forward it unchanged into the gateway JSON body (`userId`). |
| `x-debug` | Agent → Vendor | optional | When the value is one of `1,true,yes,on` (case-insensitive) we return `debug` arrays from vendor + Flow402 traces (see `apps/vendor-demo/src/index.ts`). |
| `Content-Type: application/json` | Vendor → Flow402 | ✅ | Required on `POST /api/gateway/deduct`. |
| `x-f402-key` | Vendor → Flow402 | ✅ | Vendor API key/slug/ID used to resolve the `tenants` row + signing secret. |
| `x-f402-body-sha` | Vendor → Flow402 | ✅ | Lowercase SHA-256 hash of the exact JSON body forwarded to Flow402. Prevents silent body tampering. |
| `x-f402-sig` / `X-Flow402-Signature` | Vendor ↔ Flow402 | ✅ | HMAC-SHA256 signature described below. Flow402 validates this header on incoming deduction requests, and includes a fresh signature on 200/402 responses so the vendor can verify authenticity. |
| `Idempotency-Key` | Vendor → Flow402 | ✅ (write) | Deterministic UUID/string tied to the request body. Replays with the same body + key in the last 24h return the original response without touching the ledger. |

## Deduct Request (Vendor → Flow402)

- **Endpoint**: `POST /api/gateway/deduct`
- **Body schema** (mirrors `apps/web/src/app/api/gateway/deduct/route.ts`):

| Field | Type | Description |
| --- | --- | --- |
| `userId` | UUID string | Value from `x-user-id`. |
| `ref` | string | Ledger idempotency reference recorded in `tx_ledger`. Vendor demo uses `sha256(userId|path|day)` truncated to 32 chars (`buildRef`) and also mirrors it into `Idempotency-Key`. |
| `amount_credits` | integer | Credits to reserve/deduct (unit described above). |

- **Successful response** (`200 OK`):

```json
{
  "ok": true,
  "new_balance": 12345
}
```

`new_balance` is the caller’s remaining credits.

## 402 Payment Envelope (Gateway → Vendor)

When the caller lacks funds, the gateway replies with `HTTP 402` and the following JSON envelope (see `apps/web/src/app/api/gateway/deduct/route.ts`):

| Field | Type | Description |
| --- | --- | --- |
| `price_credits` | integer | Amount required for the attempted call, in credits. |
| `currency` | string | Always `"USDC"` for the MVP. |
| `topup_url` | string | Relative URL (`/topup?need=...&user=...`) that the Flow402 dashboard can resolve into a hosted top-up experience. |

The envelope is accompanied by `X-Flow402-Signature` so the vendor can confirm Flow402 generated it before surfacing the paywall upstream. Vendors should treat unknown fields as forward-compatible additions.

### Sample 402

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
X-Flow402-Signature: t=1729200000,v1=7d6d…

{
  "price_credits": 500,
  "currency": "USDC",
  "topup_url": "/topup?need=500&user=9c0383a1-0887-4c0f-98ca-cb71ffc4e76c"
}
```

## HMAC Signing (`X-Flow402-Signature`)

- **Secret**: `FLOW402_SIGNING_SECRET` shared by the vendor and gateway (store in `.env` for both apps). The gateway also fetches per-vendor `signing_secret` values from Supabase via `x-f402-key`.
- **Header format**: `x-f402-sig: t=<unix_epoch_seconds>,v1=<hex digest>` (legacy `X-Flow402-Signature` is still accepted).
- **Body hash**: Vendors must send `x-f402-body-sha` with the lowercase SHA-256 digest of the JSON payload they post. The gateway recomputes the hash before validating `x-f402-sig`.
- **String to sign**: `t + "." + body`, where `body` is the raw request/response JSON string sent over the wire.
- **Digest**: `HMAC_SHA256(secret, string_to_sign)` encoded as lowercase hex.
- **Verification window**: Vendors should reject responses older than 5 minutes (`abs(now - t) > 300`).

Pseudo code:

```ts
const timestamp = Math.floor(Date.now() / 1000);
const payload = JSON.stringify({ userId, ref, amount_credits });
const input = `${timestamp}.${payload}`;
const signature = crypto.createHmac("sha256", FLOW402_SIGNING_SECRET).update(input).digest("hex");
const header = `t=${timestamp},v1=${signature}`;
```

The same routine applies to responses: read the header, rebuild `input` with the timestamp from the header and the exact response string, and compare using a constant-time equality check.

## Versioning

- `spec_version`: `2024-10-mvp`.
- Any breaking change (new required fields, header format changes, currency shifts) must bump the version and extend this document instead of replacing it.

## Implementation Notes

- The vendor demo (`apps/vendor-demo`) now signs every deduction request with `x-f402-key`, `x-f402-body-sha`, and `x-f402-sig`; the gateway enforces the same ±5 minute skew window before processing credits.
- Dashboard-driven credit grants (e.g., `/api/topup/mock`) also require `Idempotency-Key` so retries don't grant duplicate credits.
- The credits unit, headers, and 402 envelope described above already match the live demo implementations, so wiring in HMAC should be additive and non-breaking.

## References

- Gateway logic: `apps/web/src/app/api/gateway/deduct/route.ts`
- Vendor middleware: `apps/vendor-demo/src/index.ts`
- Agent example: `packages/agent/src/index.ts`
- **Idempotency**: Vendors must send a stable `Idempotency-Key` header for each charge attempt. Flow402 stores the response for 24 hours keyed by `{method, path, body_sha}` and replays it across app replicas instead of issuing duplicate ledger writes.
