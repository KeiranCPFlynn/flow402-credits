# Supabase Multi-tenant Credits Schema (MVP-03)

Issue **MVP-03** introduces tenant scoping so a single Supabase project can host balances for multiple Flow402-enabled vendors. This document describes the tables, RPC helpers, and migration workflow that now ship with the repository.

## Migration

Run `supabase/migrations/20251109-mvp-03-multi-tenant-credits.sql` inside the Supabase SQL editor (or `supabase db push`). The script is idempotent and does the following:

1. Ensures `public.tenants`, `public.credits`, and `public.tx_ledger` exist.
2. Adds `tenant_id` columns, defaults, indexes, and touch triggers for existing tables if they predate this change.
3. Seeds the demo tenant (`id = 0b7d4b0a-6e10-4db4-8571-2c74e07bcb35`, `slug = demo`).
4. Creates the `increment_balance` and `deduct_balance` RPCs with built-in idempotency.

Point both `FLOW402_TENANT_ID` and `NEXT_PUBLIC_FLOW402_TENANT_ID` at the tenant row you plan to use (the seeded `demo` UUID works out of the box).

## Tables

| Table | Purpose | Important Columns |
| --- | --- | --- |
| `tenants` | Catalog of vendors onboarded to Flow402. A row represents one vendor environment (demo, staging, prod, etc.). | `id` (UUID PK), `slug`, `name`. |
| `credits` | Current credit balance per `(tenant_id, user_id)`. | `tenant_id` (FK → `tenants.id`), `user_id`, `balance_cents`, `currency` (defaults to `USDC`). |
| `tx_ledger` | Immutable record of every credit mutation for auditing/idempotency. | `tenant_id`, `user_id`, `kind` (`topup`, `deduct`, `manual_reset`, `adjustment`), `amount_cents`, `ref`, `metadata`, `created_at`. |

Bitemporal auditing is possible by combining `tx_ledger` rows with the running balance in `credits`. Unique index `(tenant_id, ref)` prevents duplicate ledger entries and powers idempotent RPC calls.

## RPC Helpers

### `increment_balance`

```sql
select public.increment_balance(
    p_tenant => '0b7d4b0a-6e10-4db4-8571-2c74e07bcb35',
    p_user => '9c0383a1-0887-4c0f-98ca-cb71ffc4e76c',
    p_amount => 500,
    p_kind => 'topup',
    p_ref => 'topup_demo_001',
    p_metadata => '{"source":"dashboard"}'::jsonb
);
```

- **Returns**: `bigint` new balance (credits remaining after the top-up).
- **Idempotent**: Reusing `p_ref` short-circuits and simply returns the current balance.
- **Ledger**: Automatically appends a `tx_ledger` row so downstream analytics stay in sync.

### `deduct_balance`

```sql
select public.deduct_balance(
    p_tenant => '0b7d4b0a-6e10-4db4-8571-2c74e07bcb35',
    p_user => '9c0383a1-0887-4c0f-98ca-cb71ffc4e76c',
    p_amount => 125,
    p_ref => 'demo_call_ref',
    p_metadata => '{"endpoint":"/demo/screenshot"}'::jsonb
);
```

- **Returns**: `bigint` new balance after the deduction.
- **Insufficient funds**: Raises `insufficient_funds` (`SQLSTATE P0001`). The Next.js gateway catches this and returns HTTP 402.
- **Idempotent**: If a ledger row already exists for `(tenant_id, p_ref)` with `kind = 'deduct'`, the function returns the current balance without double-charging.

Use the RPCs instead of ad-hoc `update` statements so balance mutations remain atomic and audit trails never diverge.

## Future Work

- **Tenant & user provisioning UX** – Today, tenants and demo users are inserted manually (e.g., via SQL). The long-term flow should expose an operator surface (CLI, onboarding API, or dashboard) that: creates a tenant row, issues the Flow402 signing secret, seeds at least one user, and hands back the tenant/user UUIDs plus env vars to the vendor. Track this as a follow-up task so real vendors can self-serve instead of relying on SQL editors.
