-- Justice City - Transaction Automation Phase 2
-- Safe to run multiple times.
--
-- Adds:
-- - direct acceptance timeout support
-- - dispute records + escrow freeze state
-- - service intake PDF queue
-- - secure provider forwarding links

create extension if not exists pgcrypto;

alter table public.transactions
  add column if not exists acceptance_due_at timestamptz,
  add column if not exists escrow_frozen boolean not null default false,
  add column if not exists escrow_frozen_at timestamptz,
  add column if not exists escrow_frozen_reason text;

create index if not exists idx_transactions_acceptance_due_at
on public.transactions (acceptance_due_at)
where acceptance_due_at is not null;

create index if not exists idx_transactions_escrow_frozen
on public.transactions (escrow_frozen, updated_at desc);

create table if not exists public.transaction_disputes (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  conversation_id uuid not null,
  opened_by_user_id uuid references public.users(id) on delete set null,
  against_user_id uuid references public.users(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open'
    check (status in ('open', 'resolved', 'rejected', 'cancelled')),
  resolution text,
  resolution_target_status text,
  resolved_by_user_id uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_transaction_disputes_tx_created_at
on public.transaction_disputes (transaction_id, created_at desc);

create index if not exists idx_transaction_disputes_status_created_at
on public.transaction_disputes (status, created_at desc);

create table if not exists public.service_pdf_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  service_request_id uuid references public.service_request_records(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  payload jsonb not null default '{}'::jsonb,
  output_bucket text not null default 'conversation-transcripts',
  output_path text,
  error_message text,
  created_by_user_id uuid references public.users(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_pdf_jobs_status_created_at
on public.service_pdf_jobs (status, created_at);

create index if not exists idx_service_pdf_jobs_conversation_created_at
on public.service_pdf_jobs (conversation_id, created_at desc);

create table if not exists public.service_provider_links (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  service_request_id uuid references public.service_request_records(id) on delete set null,
  provider_user_id uuid references public.users(id) on delete set null,
  token_hash text not null unique,
  token_hint text,
  expires_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'opened', 'revoked', 'expired')),
  opened_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_provider_links_conversation_created_at
on public.service_provider_links (conversation_id, created_at desc);

create index if not exists idx_service_provider_links_provider_created_at
on public.service_provider_links (provider_user_id, created_at desc);

create index if not exists idx_service_provider_links_status_expires
on public.service_provider_links (status, expires_at);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at'
      and n.nspname = 'public'
  ) then
    drop trigger if exists trg_transaction_disputes_updated_at on public.transaction_disputes;
    create trigger trg_transaction_disputes_updated_at
    before update on public.transaction_disputes
    for each row
    execute function public.set_updated_at();

    drop trigger if exists trg_service_pdf_jobs_updated_at on public.service_pdf_jobs;
    create trigger trg_service_pdf_jobs_updated_at
    before update on public.service_pdf_jobs
    for each row
    execute function public.set_updated_at();

    drop trigger if exists trg_service_provider_links_updated_at on public.service_provider_links;
    create trigger trg_service_provider_links_updated_at
    before update on public.service_provider_links
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;
