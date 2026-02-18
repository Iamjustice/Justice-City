-- Justice City - Transaction Flow Automation Core
-- Safe to run multiple times.
--
-- Adds backend primitives for:
-- - marketplace/service transaction lifecycle tracking
-- - chat action cards with role-locked resolution
-- - payout/refund idempotency ledger
-- - transaction-scoped ratings rules
-- - contact verification flags on public.users

create extension if not exists pgcrypto;

alter table public.users
  add column if not exists email_verified boolean not null default false,
  add column if not exists phone_verified boolean not null default false;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique,
  transaction_kind text not null
    check (transaction_kind in ('sale', 'rent', 'service', 'booking')),
  closing_mode text
    check (closing_mode in ('agent_led', 'direct')),
  status text not null default 'initiated',
  buyer_user_id uuid references public.users(id) on delete set null,
  seller_user_id uuid references public.users(id) on delete set null,
  agent_user_id uuid references public.users(id) on delete set null,
  provider_user_id uuid references public.users(id) on delete set null,
  currency text not null default 'NGN',
  principal_amount numeric(14,2) check (principal_amount is null or principal_amount >= 0),
  inspection_fee_amount numeric(14,2) not null default 0 check (inspection_fee_amount >= 0),
  inspection_fee_refundable boolean not null default true,
  inspection_fee_status text not null default 'not_applicable'
    check (
      inspection_fee_status in (
        'not_applicable',
        'inspection_fee_requested',
        'inspection_fee_paid_pending_verification',
        'inspection_fee_paid',
        'inspection_fee_refund_pending',
        'inspection_fee_refunded'
      )
    ),
  escrow_reference text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_transactions_status_created_at
on public.transactions (status, created_at desc);

create index if not exists idx_transactions_kind_status
on public.transactions (transaction_kind, status);

create index if not exists idx_transactions_buyer_created_at
on public.transactions (buyer_user_id, created_at desc);

create table if not exists public.transaction_status_history (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by_user_id uuid references public.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_transaction_status_history_tx_created_at
on public.transaction_status_history (transaction_id, created_at desc);

create table if not exists public.chat_actions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  conversation_id uuid not null,
  action_type text not null
    check (
      action_type in (
        'inspection_request',
        'escrow_payment_request',
        'upload_payment_proof',
        'contract_prompt',
        'request_signed_contract',
        'schedule_meeting_request',
        'upload_signed_closing_contract',
        'mark_delivered',
        'accept_delivery',
        'service_intake_form',
        'service_quote',
        'upload_service_deliverable',
        'rating_request'
      )
    ),
  target_role text not null
    check (target_role in ('buyer', 'seller', 'agent', 'owner', 'renter', 'admin', 'support')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'submitted', 'expired', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.users(id) on delete set null,
  resolved_by_user_id uuid references public.users(id) on delete set null,
  expires_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_actions_conversation_status_created_at
on public.chat_actions (conversation_id, status, created_at desc);

create index if not exists idx_chat_actions_transaction_created_at
on public.chat_actions (transaction_id, created_at desc);

create table if not exists public.payout_ledger (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  ledger_type text not null check (ledger_type in ('payout', 'refund', 'commission')),
  idempotency_key text not null unique,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'NGN',
  recipient_user_id uuid references public.users(id) on delete set null,
  status text not null default 'claimed'
    check (status in ('claimed', 'paid', 'failed', 'cancelled')),
  reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payout_ledger_tx_created_at
on public.payout_ledger (transaction_id, created_at desc);

create table if not exists public.transaction_ratings (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  rater_user_id uuid not null references public.users(id) on delete cascade,
  rated_user_id uuid references public.users(id) on delete set null,
  stars integer not null check (stars between 1 and 5),
  review text,
  editable_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, rater_user_id)
);

create index if not exists idx_transaction_ratings_rated_created_at
on public.transaction_ratings (rated_user_id, created_at desc);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at'
      and n.nspname = 'public'
  ) then
    drop trigger if exists trg_transactions_updated_at on public.transactions;
    create trigger trg_transactions_updated_at
    before update on public.transactions
    for each row
    execute function public.set_updated_at();

    drop trigger if exists trg_chat_actions_updated_at on public.chat_actions;
    create trigger trg_chat_actions_updated_at
    before update on public.chat_actions
    for each row
    execute function public.set_updated_at();

    drop trigger if exists trg_payout_ledger_updated_at on public.payout_ledger;
    create trigger trg_payout_ledger_updated_at
    before update on public.payout_ledger
    for each row
    execute function public.set_updated_at();

    drop trigger if exists trg_transaction_ratings_updated_at on public.transaction_ratings;
    create trigger trg_transaction_ratings_updated_at
    before update on public.transaction_ratings
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;
