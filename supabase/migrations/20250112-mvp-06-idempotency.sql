-- MVP-06: shared idempotency guard for write endpoints

create table if not exists public.idempotency_keys (
    id text primary key,
    method text not null,
    path text not null,
    body_sha text not null,
    response_status integer,
    response_body jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idempotency_keys_created_idx
    on public.idempotency_keys (created_at);

create index if not exists idempotency_keys_path_idx
    on public.idempotency_keys (path);
