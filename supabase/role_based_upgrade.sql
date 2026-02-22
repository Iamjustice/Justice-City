-- Justice City - Role-Based Supabase Upgrade
-- Safe to run multiple times.
-- Use this when your project already has partial tables but needs role-based support.

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- ROLE / STATUS ENUMS
-- -------------------------------------------------------------------
do $$
begin
  create type public.user_role as enum ('buyer', 'seller', 'agent', 'admin');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.user_role add value if not exists 'owner';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.user_role add value if not exists 'renter';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.user_status as enum ('active', 'suspended');
exception
  when duplicate_object then null;
end
$$;

-- -------------------------------------------------------------------
-- UPDATED_AT TRIGGER FUNCTION
-- -------------------------------------------------------------------
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
-- USERS TABLE (ROLE-BASED)
-- -------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  full_name text,
  email text unique,
  role public.user_role not null default 'buyer',
  status public.user_status not null default 'active',
  is_verified boolean not null default false,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists role public.user_role default 'buyer',
  add column if not exists status public.user_status default 'active',
  add column if not exists is_verified boolean default false,
  add column if not exists avatar_url text,
  add column if not exists phone text,
  add column if not exists gender text,
  add column if not exists date_of_birth text,
  add column if not exists home_address text,
  add column if not exists office_address text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.users
set role = coalesce(role, 'buyer'::public.user_role),
    status = coalesce(status, 'active'::public.user_status),
    is_verified = coalesce(is_verified, false),
    updated_at = coalesce(updated_at, now()),
    created_at = coalesce(created_at, now());

alter table public.users
  alter column role set default 'buyer',
  alter column status set default 'active',
  alter column is_verified set default false,
  alter column created_at set default now(),
  alter column updated_at set default now();

create unique index if not exists idx_users_email_unique
on public.users (lower(email))
where email is not null;

create or replace trigger trg_users_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- VERIFICATIONS TABLE
-- -------------------------------------------------------------------
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
-- VERIFICATION DOCUMENTS
-- -------------------------------------------------------------------
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
-- FLAGGED LISTINGS + COMMENTS
-- -------------------------------------------------------------------
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
-- ADMIN CHAT CARDS (IN-APP ISSUE NOTIFICATIONS)
-- -------------------------------------------------------------------
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

create index if not exists idx_admin_chat_cards_user_id
on public.admin_chat_cards (user_id, created_at desc);

-- -------------------------------------------------------------------
-- REVENUE RECORDS
-- -------------------------------------------------------------------
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

create index if not exists idx_revenue_records_month
on public.revenue_records (month, record_date);

create or replace trigger trg_revenue_records_updated_at
before update on public.revenue_records
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- ROLE-PERMISSION TABLES
-- -------------------------------------------------------------------
create table if not exists public.permissions (
  code text primary key,
  description text not null
);

create table if not exists public.role_permissions (
  role public.user_role not null,
  permission_code text not null references public.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_code)
);

insert into public.permissions (code, description) values
  ('users.read', 'View user records'),
  ('users.manage', 'Manage users and account state'),
  ('verifications.read', 'View verification records'),
  ('verifications.review', 'Approve/reject verification requests'),
  ('flagged.read', 'View flagged listings'),
  ('flagged.manage', 'Change flagged listing status'),
  ('flagged.comment', 'Send issue comments to users'),
  ('chat.use', 'Use in-app chat and conversation features'),
  ('chat.moderate', 'View and moderate all chat conversations'),
  ('commissions.read', 'View commission records'),
  ('commissions.manage', 'Manage commission records and payouts'),
  ('documents.read', 'View property documents and contracts'),
  ('billing.read', 'View bills and expense records'),
  ('billing.manage', 'Manage bills and expense records'),
  ('revenue.read', 'View revenue analytics')
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_code) values
  ('admin', 'users.read'),
  ('admin', 'users.manage'),
  ('admin', 'verifications.read'),
  ('admin', 'verifications.review'),
  ('admin', 'flagged.read'),
  ('admin', 'flagged.manage'),
  ('admin', 'flagged.comment'),
  ('admin', 'chat.use'),
  ('admin', 'chat.moderate'),
  ('admin', 'commissions.read'),
  ('admin', 'commissions.manage'),
  ('admin', 'documents.read'),
  ('admin', 'billing.read'),
  ('admin', 'billing.manage'),
  ('admin', 'revenue.read'),
  ('agent', 'chat.use'),
  ('agent', 'verifications.read'),
  ('agent', 'commissions.read'),
  ('agent', 'documents.read'),
  ('seller', 'chat.use'),
  ('seller', 'verifications.read'),
  ('seller', 'documents.read'),
  ('buyer', 'chat.use'),
  ('buyer', 'verifications.read'),
  ('buyer', 'documents.read')
on conflict (role, permission_code) do nothing;

-- NOTE:
-- Supabase SQL editor typically executes the whole script in one transaction.
-- PostgreSQL does not allow newly added enum labels (e.g., owner/renter) to be
-- used in the same transaction where they were added.
--
-- Run `supabase/role_owner_renter_permissions.sql` after this script commits
-- to seed owner/renter permissions safely.

create or replace function public.user_has_role(
  p_user_id uuid,
  p_role public.user_role
)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.users
    where id = p_user_id
      and role = p_role
      and status = 'active'
  );
$$;

create or replace function public.user_has_permission(
  p_user_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.users u
    join public.role_permissions rp
      on rp.role = u.role
    where u.id = p_user_id
      and u.status = 'active'
      and rp.permission_code = p_permission_code
  );
$$;
