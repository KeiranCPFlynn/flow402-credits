-- MVP-04: typed DAL support (vendor metadata, users, and settings)

-- Ensure tenants have API keys + signing secrets
alter table public.tenants
    add column if not exists api_key text,
    add column if not exists signing_secret text;

-- Generate defaults for existing tenants
update public.tenants
set api_key = coalesce(api_key, encode(gen_random_bytes(16), 'hex'));

update public.tenants
set signing_secret = coalesce(signing_secret, encode(gen_random_bytes(32), 'hex'));

alter table public.tenants
    alter column api_key set not null,
    alter column signing_secret set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'tenants_api_key_unique'
    ) then
        alter table public.tenants
            add constraint tenants_api_key_unique unique (api_key);
    end if;
end$$;

-- Vendor users table mirrors tenant + per-user metadata
create table if not exists public.vendor_users (
    vendor_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null,
    user_external_id text not null,
    eth_address text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (vendor_id, user_id)
);

create index if not exists vendor_users_vendor_idx
    on public.vendor_users (vendor_id, user_id);

create unique index if not exists vendor_users_external_idx
    on public.vendor_users (vendor_id, user_external_id);

drop trigger if exists vendor_users_touch_updated_at on public.vendor_users;
create trigger vendor_users_touch_updated_at
before update on public.vendor_users
for each row execute function public.touch_updated_at();

-- Backfill vendor_users from existing credits rows
insert into public.vendor_users (vendor_id, user_id, user_external_id)
select c.tenant_id, c.user_id, c.user_id::text
from public.credits c
where not exists (
    select 1
    from public.vendor_users vu
    where vu.vendor_id = c.tenant_id
      and vu.user_id = c.user_id
);

-- Link credits + ledger tables to vendor_users for referential integrity
do $$
begin
    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'credits'
    ) then
        begin
            alter table public.credits
                add constraint credits_vendor_user_fk
                    foreign key (tenant_id, user_id)
                    references public.vendor_users(vendor_id, user_id)
                    on delete cascade;
        exception
            when duplicate_object then null;
        end;
    end if;
end$$;

do $$
begin
    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'tx_ledger'
    ) then
        begin
            alter table public.tx_ledger
                add constraint tx_ledger_vendor_user_fk
                    foreign key (tenant_id, user_id)
                    references public.vendor_users(vendor_id, user_id)
                    on delete cascade;
        exception
            when duplicate_object then null;
        end;
    end if;
end$$;

-- User settings table
create table if not exists public.vendor_user_settings (
    vendor_id uuid not null,
    user_id uuid not null,
    settings jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (vendor_id, user_id),
    constraint vendor_user_settings_fk
        foreign key (vendor_id, user_id)
        references public.vendor_users(vendor_id, user_id)
        on delete cascade
);

create index if not exists vendor_user_settings_idx
    on public.vendor_user_settings (vendor_id, user_id);

drop trigger if exists vendor_user_settings_touch_updated_at on public.vendor_user_settings;
create trigger vendor_user_settings_touch_updated_at
before update on public.vendor_user_settings
for each row execute function public.touch_updated_at();
