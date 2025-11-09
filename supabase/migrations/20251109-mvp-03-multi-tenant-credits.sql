-- MVP-03: Multi-tenant schema + RPCs (Supabase) — credits
-- This migration makes the credits + ledger tables tenant-aware and ships the
-- RPC helpers the Next/Vendor apps rely on.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenants catalog
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Seed the demo tenant so local/dev environments share the same UUID.
insert into public.tenants (id, slug, name)
values (
    '0b7d4b0a-6e10-4db4-8571-2c74e07bcb35'::uuid,
    'demo',
    'Flow402 Demo Tenant'
)
on conflict (slug) do nothing;

-- Keep updated_at in sync on writes.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists tenants_touch_updated_at on public.tenants;
create trigger tenants_touch_updated_at
before update on public.tenants
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Credits table (per tenant + user)
-- ---------------------------------------------------------------------------
create table if not exists public.credits (
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null,
    balance_cents bigint not null default 0,
    currency text not null default 'USDC',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (tenant_id, user_id)
);

do $$
begin
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'credits'
          and column_name = 'tenant_id'
    ) then
        alter table public.credits add column tenant_id uuid;
        update public.credits
        set tenant_id = '0b7d4b0a-6e10-4db4-8571-2c74e07bcb35'::uuid
        where tenant_id is null;
        alter table public.credits
            alter column tenant_id set not null,
            add constraint credits_tenant_fk
                foreign key (tenant_id) references public.tenants(id) on delete cascade;
    end if;
end$$;

alter table public.credits
    alter column balance_cents type bigint using balance_cents::bigint,
    alter column balance_cents set default 0,
    alter column balance_cents set not null;

do $$
begin
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'credits'
          and column_name = 'currency'
    ) then
        alter table public.credits add column currency text;
        update public.credits set currency = 'USDC' where currency is null;
        alter table public.credits
            alter column currency set default 'USDC',
            alter column currency set not null;
    end if;
end$$;

do $$
begin
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'credits'
          and column_name = 'created_at'
    ) then
        alter table public.credits add column created_at timestamptz;
        update public.credits
        set created_at = coalesce(updated_at, now())
        where created_at is null;
        alter table public.credits
            alter column created_at set default now(),
            alter column created_at set not null;
    end if;
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'credits'
          and column_name = 'updated_at'
    ) then
        alter table public.credits add column updated_at timestamptz;
        update public.credits
        set updated_at = now()
        where updated_at is null;
        alter table public.credits
            alter column updated_at set default now();
    else
        alter table public.credits
            alter column updated_at set default now();
    end if;
end$$;

drop trigger if exists credits_touch_updated_at on public.credits;
create trigger credits_touch_updated_at
before update on public.credits
for each row execute function public.touch_updated_at();

alter table public.credits
    drop constraint if exists credits_pkey;
alter table public.credits
    add constraint credits_pkey primary key (tenant_id, user_id);

create index if not exists credits_user_idx
    on public.credits (user_id, tenant_id);

-- ---------------------------------------------------------------------------
-- Ledger table (records every balance mutation)
-- ---------------------------------------------------------------------------
create table if not exists public.tx_ledger (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null,
    kind text not null,
    amount_cents bigint not null,
    ref text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

do $$
begin
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tx_ledger'
          and column_name = 'tenant_id'
    ) then
        alter table public.tx_ledger add column tenant_id uuid;
        update public.tx_ledger
        set tenant_id = '0b7d4b0a-6e10-4db4-8571-2c74e07bcb35'::uuid
        where tenant_id is null;
        alter table public.tx_ledger
            alter column tenant_id set not null,
            add constraint tx_ledger_tenant_fk
                foreign key (tenant_id) references public.tenants(id) on delete cascade;
    end if;
end$$;

do $$
begin
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tx_ledger'
          and column_name = 'metadata'
    ) then
        alter table public.tx_ledger add column metadata jsonb not null default '{}'::jsonb;
    end if;
end$$;

alter table public.tx_ledger
    alter column amount_cents type bigint using amount_cents::bigint,
    alter column amount_cents set not null;

alter table public.tx_ledger
    alter column ref type text using ref::text;

do $$
begin
    if exists (
        select 1
        from pg_constraint
        where conname = 'tx_ledger_kind_check'
          and conrelid = 'public.tx_ledger'::regclass
    ) then
        alter table public.tx_ledger
            drop constraint tx_ledger_kind_check;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'tx_ledger_kind_check'
          and conrelid = 'public.tx_ledger'::regclass
    ) then
        alter table public.tx_ledger
            add constraint tx_ledger_kind_check
                check (
                    kind in ('topup', 'deduct', 'manual_reset', 'adjustment')
                );
    end if;
end$$;

create index if not exists tx_ledger_user_idx
    on public.tx_ledger (tenant_id, user_id, created_at desc);

-- Drop duplicate refs before enforcing uniqueness
with duplicates as (
    select ctid, row_number() over (
        partition by tenant_id, ref
        order by created_at nulls last, ctid
    ) as rownum
    from public.tx_ledger
    where ref is not null
)
delete from public.tx_ledger
where ctid in (
    select ctid from duplicates where rownum > 1
);

create unique index if not exists tx_ledger_tenant_ref_idx
    on public.tx_ledger (tenant_id, ref)
    where ref is not null;

-- ---------------------------------------------------------------------------
-- RPC helpers
-- ---------------------------------------------------------------------------
create or replace function public.increment_balance(
    p_tenant uuid,
    p_user uuid,
    p_amount bigint,
    p_kind text default 'topup',
    p_ref text default null,
    p_metadata jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ref text := nullif(trim(coalesce(p_ref, '')), '');
    v_balance bigint;
    v_existing_kind text;
begin
    if p_amount is null or p_amount <= 0 then
        raise exception using message = 'amount must be positive', errcode = '22023';
    end if;

    if p_tenant is null then
        raise exception using message = 'tenant required', errcode = '22004';
    end if;

    if p_user is null then
        raise exception using message = 'user required', errcode = '22004';
    end if;

    if v_ref is null then
        v_ref = format('topup_%s', encode(gen_random_bytes(6), 'hex'));
    end if;

    select kind
    into v_existing_kind
    from public.tx_ledger
    where tenant_id = p_tenant
      and ref = v_ref
    limit 1;

    if found then
        if v_existing_kind <> 'topup' then
            raise exception using message = 'ref already used for non-topup entry', errcode = 'P0002';
        end if;

        select balance_cents
        into v_balance
        from public.credits
        where tenant_id = p_tenant
          and user_id = p_user;

        return coalesce(v_balance, 0);
    end if;

    insert into public.credits as c (tenant_id, user_id, balance_cents)
    values (p_tenant, p_user, p_amount)
    on conflict (tenant_id, user_id) do update
        set balance_cents = c.balance_cents + excluded.balance_cents,
            updated_at = now()
    returning c.balance_cents into v_balance;

    insert into public.tx_ledger (tenant_id, user_id, kind, amount_cents, ref, metadata)
    values (
        p_tenant,
        p_user,
        coalesce(nullif(p_kind, ''), 'topup'),
        p_amount,
        v_ref,
        coalesce(p_metadata, '{}'::jsonb)
    );

    return v_balance;
end;
$$;

create or replace function public.deduct_balance(
    p_tenant uuid,
    p_user uuid,
    p_amount bigint,
    p_ref text,
    p_metadata jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_balance bigint;
    v_existing_kind text;
begin
    if p_amount is null or p_amount <= 0 then
        raise exception using message = 'amount must be positive', errcode = '22023';
    end if;

    if p_tenant is null then
        raise exception using message = 'tenant required', errcode = '22004';
    end if;

    if p_user is null then
        raise exception using message = 'user required', errcode = '22004';
    end if;

    if p_ref is null or trim(p_ref) = '' then
        raise exception using message = 'ref required', errcode = '22004';
    end if;

    select kind
    into v_existing_kind
    from public.tx_ledger
    where tenant_id = p_tenant
      and ref = p_ref
    limit 1;

    if found then
        if v_existing_kind <> 'deduct' then
            raise exception using message = 'ref already used for non-deduct entry', errcode = 'P0003';
        end if;

        select balance_cents
        into v_balance
        from public.credits
        where tenant_id = p_tenant
          and user_id = p_user;

        return coalesce(v_balance, 0);
    end if;

    update public.credits as c
    set balance_cents = c.balance_cents - p_amount,
        updated_at = now()
    where c.tenant_id = p_tenant
      and c.user_id = p_user
      and c.balance_cents >= p_amount
    returning c.balance_cents into v_balance;

    if v_balance is null then
        raise exception using message = 'insufficient_funds', errcode = 'P0001';
    end if;

    insert into public.tx_ledger (tenant_id, user_id, kind, amount_cents, ref, metadata)
    values (p_tenant, p_user, 'deduct', p_amount, p_ref, coalesce(p_metadata, '{}'::jsonb));

    return v_balance;
end;
$$;
