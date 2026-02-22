-- Justice City - Supabase schema bootstrap
-- Run this in the Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Generic trigger function to maintain updated_at timestamps.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------------
-- USERS TABLE
-- -------------------------------------------------------------------
-- Mirrors the shape consumed by server/storage.ts
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  full_name text,
  email text,
  role text default 'buyer',
  status text default 'active',
  is_verified boolean not null default false,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  avatar_url text,
  phone text,
  gender text,
  date_of_birth text,
  home_address text,
  office_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger trg_users_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- VERIFICATIONS TABLE
-- -------------------------------------------------------------------
-- Stores Smile ID verification jobs submitted from the API.
create table if not exists public.verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mode text not null check (mode in ('kyc', 'biometric')),
  provider text not null check (provider in ('smile-id', 'mock')),
  status text not null check (status in ('approved', 'pending', 'failed')),
  job_id text not null unique,
  smile_job_id text,
  message text,
  home_address text,
  office_address text,
  date_of_birth text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_verifications_user_id on public.verifications (user_id);
create index if not exists idx_verifications_status on public.verifications (status);
create index if not exists idx_verifications_created_at on public.verifications (created_at desc);

create or replace trigger trg_verifications_updated_at
before update on public.verifications
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- VERIFICATION DOCUMENTS TABLE
-- -------------------------------------------------------------------
-- Stores admin-facing document links for each verification row.
create table if not exists public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.verifications(id) on delete cascade,
  document_type text not null,
  document_url text not null,
  bucket_id text default 'verification-documents',
  storage_path text,
  uploaded_by uuid references public.users(id) on delete set null,
  mime_type text,
  file_size_bytes bigint,
  extracted_address text,
  input_home_address text,
  address_match_status text,
  address_match_score numeric,
  address_match_method text,
  created_at timestamptz not null default now()
);

create index if not exists idx_verification_documents_verification_id
on public.verification_documents (verification_id);

-- -------------------------------------------------------------------
-- FLAGGED LISTINGS TABLE
-- -------------------------------------------------------------------
-- Queue used by admin compliance review.
create table if not exists public.flagged_listings (
  id uuid primary key default gen_random_uuid(),
  listing_title text not null,
  location text not null,
  issue_reason text not null,
  status text not null check (status in ('open', 'under_review', 'cleared')) default 'open',
  affected_user_id text not null,
  affected_user_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_flagged_listings_status on public.flagged_listings (status);
create index if not exists idx_flagged_listings_updated_at on public.flagged_listings (updated_at desc);

create or replace trigger trg_flagged_listings_updated_at
before update on public.flagged_listings
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- FLAGGED LISTING COMMENTS TABLE
-- -------------------------------------------------------------------
-- Stores admin comments and problem tags posted to users.
create table if not exists public.flagged_listing_comments (
  id uuid primary key default gen_random_uuid(),
  flagged_listing_id uuid not null references public.flagged_listings(id) on delete cascade,
  comment text not null,
  problem_tag text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_flagged_listing_comments_listing_id
on public.flagged_listing_comments (flagged_listing_id, created_at desc);

-- -------------------------------------------------------------------
-- ADMIN CHAT CARDS TABLE
-- -------------------------------------------------------------------
-- Outbound in-app chat cards sent to affected users.
create table if not exists public.admin_chat_cards (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_name text not null,
  title text not null,
  message text not null,
  problem_tag text not null,
  status text not null check (status in ('unread', 'read')) default 'unread',
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_chat_cards_user_id on public.admin_chat_cards (user_id, created_at desc);

-- -------------------------------------------------------------------
-- REVENUE RECORDS TABLE
-- -------------------------------------------------------------------
-- Monthly revenue ledger used for admin charting.
create table if not exists public.revenue_records (
  id uuid primary key default gen_random_uuid(),
  month text not null, -- YYYY-MM
  record_date date not null,
  source text not null,
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  commission_rate numeric(5,4) not null default 0.0500 check (commission_rate >= 0),
  net_revenue numeric(14,2) not null check (net_revenue >= 0),
  status text not null check (status in ('received', 'pending')) default 'received',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_revenue_records_month on public.revenue_records (month, record_date);

create or replace trigger trg_revenue_records_updated_at
before update on public.revenue_records
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- HELPER FUNCTION FOR CALLBACK HANDLING
-- -------------------------------------------------------------------
-- Optional helper your API can call via rpc() if needed later.
create or replace function public.update_verification_status(
  p_job_id text,
  p_status text,
  p_message text default null
)
returns void
language plpgsql
as $$
begin
  if p_status not in ('approved', 'pending', 'failed') then
    raise exception 'Invalid verification status: %', p_status;
  end if;

  update public.verifications
  set status = p_status,
      message = coalesce(p_message, message),
      updated_at = now()
  where job_id = p_job_id;
end;
$$;

-- -------------------------------------------------------------------
-- OPTIONAL VIEW FOR DASHBOARDING
-- -------------------------------------------------------------------
create or replace view public.verification_summary as
select
  status,
  count(*) as total
from public.verifications
group by status;

-- -------------------------------------------------------------------
-- OPTIONAL STARTER DATA FOR ADMIN DASHBOARD
-- -------------------------------------------------------------------
insert into public.flagged_listings (
  id,
  listing_title,
  location,
  issue_reason,
  status,
  affected_user_id,
  affected_user_name
) values
  ('2fd4004d-3054-4edd-96fc-fe9efcb8f1c1', '4 Bedroom Duplex', 'Ikoyi, Lagos', 'Suspicious document mismatch', 'cleared', 'usr_103', 'Adekunle Gold'),
  ('95f4f7d0-1042-46d3-a14b-e4bcd4ef22da', 'Oceanfront Plot', 'Ajah, Lagos', 'Multiple duplicate submissions', 'open', 'usr_104', 'Simi Kosoko'),
  ('4bfe4013-25d7-4fe5-b43f-4fcbbafcf09d', 'Commercial Plaza', 'Port Harcourt', 'Ownership conflict alert', 'under_review', 'usr_105', 'Burna Boy')
on conflict (id) do nothing;

insert into public.revenue_records (
  id,
  month,
  record_date,
  source,
  gross_amount,
  commission_rate,
  net_revenue,
  status
) values
  ('8abf5f82-763b-4016-9636-9d3fe8d0e5bd', '2026-01', '2026-01-04', 'Property Verification Fees', 1250000, 0.0500, 1250000, 'received'),
  ('2bc687db-24d8-490e-aa18-67688052c8cd', '2026-01', '2026-01-11', 'Agent Listing Commission', 1100000, 0.0500, 1100000, 'received'),
  ('8026d9ef-d7d2-4f44-a2ee-5ecf1fd28dca', '2026-01', '2026-01-17', 'Escrow Processing Fees', 900000, 0.0500, 900000, 'received'),
  ('9f31a82c-2834-489d-932b-b5c7af8ad96c', '2026-01', '2026-01-23', 'KYC Service Charges', 600000, 0.0500, 600000, 'pending'),
  ('a89fcb4a-e6c3-4da8-aa42-7f25e9cb4ec6', '2026-01', '2026-01-29', 'Fraud Report Investigations', 350000, 0.0500, 350000, 'received')
on conflict (id) do nothing;
