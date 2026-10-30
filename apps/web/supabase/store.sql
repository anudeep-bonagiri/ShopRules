-- Shop Rules document store (DATABASE_URL). One row per workspace; the app
-- reads the document in one query and writes it back with a version check.
-- Row level security is on with no policies so PostgREST clients cannot read
-- these tables; the app connects as the database owner, which bypasses RLS.

create table if not exists workspaces (
  id text primary key,
  doc jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists tokens (
  token text primary key,
  account_id text not null references workspaces (id) on delete cascade
);

create index if not exists tokens_account_id on tokens (account_id);

alter table workspaces enable row level security;
alter table tokens enable row level security;
