-- Shopper Remote - relay schema (P-15, v2.92).
--
-- Run this once in the Supabase SQL editor after creating the project.
--
-- ---------------------------------------------------------------------
-- THE ACCESS MODEL, STATED PLAINLY
-- ---------------------------------------------------------------------
-- Auth is Google-login-only, one layer, by Zach's explicit decision on
-- 2026-09-08. He declined the QR-paired device-key/signed-command layer
-- and declined the remote-start spend ceiling offered as its mitigation.
-- The accepted residual risk, recorded in the backlog: a compromised
-- relay or Google account could start a run, bounded only by the Buy
-- Queue's existing safety cap and spend-target logic.
--
-- So RLS below is scoped to ONE user id - the owner's. Not "any signed-in
-- user": a Supabase project with Google auth enabled will happily create
-- an account for anyone who signs in with Google, and "authenticated"
-- would hand every one of them the ability to start a buy run.
--
-- ⚠ REPLACE <OWNER_UID> BELOW with the uid from Authentication -> Users
-- after signing in once. Nothing works until you do, which is deliberate:
-- failing closed is the right direction for a table that can spend money.

create table if not exists devices (
  device_id         text primary key,
  device_name       text,
  role              text not null default 'active',
  protocol_version  int  not null default 1,
  last_seen         timestamptz not null default now(),
  owner             uuid not null default auth.uid()
);

create table if not exists device_state (
  -- No foreign key to devices() on purpose: publishing state and sending a
  -- heartbeat are independent, and after a service-worker restart a publish
  -- can land first. An FK would turn that ordering race into a failed
  -- publish and a phone showing nothing, for no benefit.
  device_id   text primary key,
  device_name text,
  v           int not null default 1,
  payload     jsonb not null,
  updated_at  timestamptz not null default now(),
  owner       uuid not null default auth.uid()
);

create table if not exists commands (
  id         uuid primary key default gen_random_uuid(),
  v          int  not null default 1,
  device_id  text not null,
  name       text not null,
  payload    jsonb not null default '{}'::jsonb,
  issued_at  timestamptz not null default now(),
  status     text not null default 'pending',
  reason     text,
  result     jsonb,
  updated_at timestamptz,
  -- RESERVED, always null in v1. The signing layer was declined; this
  -- column exists so it can be added later with no migration. The
  -- extension REFUSES a command that carries a non-null signature,
  -- because a v1 install must never imply it checked one.
  signature  text,
  role       text not null default 'active',
  owner      uuid not null default auth.uid()
);
create index if not exists commands_pending_idx on commands (device_id, status, issued_at);

create table if not exists push_subs (
  endpoint     text primary key,
  subscription jsonb not null,
  updated_at   timestamptz not null default now(),
  owner        uuid not null default auth.uid()
);

create table if not exists push_outbox (
  id         uuid primary key default gen_random_uuid(),
  device_id  text not null,
  title      text not null,
  body       text not null,
  tag        text,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  owner      uuid not null default auth.uid()
);

alter table devices      enable row level security;
alter table device_state enable row level security;
alter table commands     enable row level security;
alter table push_subs    enable row level security;
alter table push_outbox  enable row level security;

-- One owner. Replace <OWNER_UID> in all five policies.
create policy owner_all on devices      for all using (auth.uid() = '<OWNER_UID>') with check (auth.uid() = '<OWNER_UID>');
create policy owner_all on device_state for all using (auth.uid() = '<OWNER_UID>') with check (auth.uid() = '<OWNER_UID>');
create policy owner_all on commands     for all using (auth.uid() = '<OWNER_UID>') with check (auth.uid() = '<OWNER_UID>');
create policy owner_all on push_subs    for all using (auth.uid() = '<OWNER_UID>') with check (auth.uid() = '<OWNER_UID>');
create policy owner_all on push_outbox  for all using (auth.uid() = '<OWNER_UID>') with check (auth.uid() = '<OWNER_UID>');

-- Housekeeping: a command row is a claim about the present, not history.
-- (Same lesson as the shipment prompt list in v2.91 - anything that
-- accumulates "things to act on" must be reconciled, not just capped.)
create or replace function prune_commands() returns void language sql as $$
  delete from commands where issued_at < now() - interval '7 days';
  delete from push_outbox where created_at < now() - interval '7 days';
$$;
