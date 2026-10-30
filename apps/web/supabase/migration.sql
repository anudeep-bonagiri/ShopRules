-- Shop Rules schema. Every table is gated by one shared secret that the web app
-- sends as the x-sr-secret header; the publishable key alone reads nothing.
-- Run this once against your Supabase project, then set SR_DB_SECRET to the
-- same value you insert into sr_config.

create extension if not exists pgcrypto;

create table if not exists public.sr_config (
  key text primary key,
  value text not null
);
alter table public.sr_config enable row level security;
-- No policies on sr_config: it is unreachable through the API by design.

create or replace function public.sr_authorized()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-sr-secret', '') <> ''
     and coalesce(current_setting('request.headers', true)::json ->> 'x-sr-secret', '')
         = (select value from public.sr_config where key = 'secret');
$$;

create table if not exists public.sr_accounts (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  telegram_chat_id text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sr_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.sr_accounts(id) on delete cascade,
  url text not null,
  marketplace text not null,
  title text not null,
  price numeric,
  currency text,
  image_url text,
  profile jsonb not null,
  extracted_text text,
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  unique (account_id, url)
);

create table if not exists public.sr_rules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.sr_accounts(id) on delete cascade,
  product_id uuid not null references public.sr_products(id) on delete cascade,
  family text not null,
  key text not null,
  title text not null,
  query text not null,
  include_domains jsonb not null default '[]'::jsonb,
  include_domains_mode text not null default 'prefer',
  cadence_hours integer not null default 24,
  state text,
  seed_note text,
  last_run_at timestamptz,
  last_hash text,
  last_headline text,
  created_at timestamptz not null default now()
);

create table if not exists public.sr_alerts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.sr_accounts(id) on delete cascade,
  product_id uuid not null references public.sr_products(id) on delete cascade,
  rule_id uuid not null references public.sr_rules(id) on delete cascade,
  status text not null default 'new',
  family text not null,
  severity text not null,
  relevance text not null,
  headline text not null,
  claims jsonb not null default '[]'::jsonb,
  proposed integer not null default 0,
  backed integer not null default 0,
  rejected integer not null default 0,
  impact jsonb not null default '{}'::jsonb,
  action jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  dismiss_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.sr_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.sr_accounts(id) on delete cascade,
  product_id uuid,
  kind text not null,
  tavily_calls integer not null default 0,
  tavily_credits integer not null default 0,
  llm jsonb not null default '[]'::jsonb,
  llm_cost_usd numeric not null default 0,
  all_ultra_cost_usd numeric not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.sr_skills (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.sr_accounts(id) on delete cascade,
  product_id uuid references public.sr_products(id) on delete cascade,
  scope text not null default 'product',
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sr_prices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.sr_accounts(id) on delete cascade,
  product_id uuid not null references public.sr_products(id) on delete cascade,
  price numeric not null,
  currency text,
  source text not null default 'listing',
  at timestamptz not null default now()
);

create index if not exists sr_products_account_idx on public.sr_products(account_id, created_at desc);
create index if not exists sr_rules_product_idx on public.sr_rules(product_id);
create index if not exists sr_rules_account_idx on public.sr_rules(account_id, last_run_at);
create index if not exists sr_alerts_account_idx on public.sr_alerts(account_id, status, created_at desc);
create index if not exists sr_alerts_product_idx on public.sr_alerts(product_id);
create index if not exists sr_runs_account_idx on public.sr_runs(account_id, created_at desc);
create index if not exists sr_prices_product_idx on public.sr_prices(product_id, at);

do $$
declare t text;
begin
  foreach t in array array['sr_accounts','sr_products','sr_rules','sr_alerts','sr_runs','sr_skills','sr_prices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_secret', t);
    execute format('create policy %I on public.%I for all using (public.sr_authorized()) with check (public.sr_authorized())', t || '_secret', t);
  end loop;
end $$;
