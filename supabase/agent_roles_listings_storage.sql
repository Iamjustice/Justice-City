-- Justice City - Agent Roles, Listings, Verification Workflow, and Storage
-- Safe to run multiple times.
-- Run this after supabase/schema.sql (or supabase/role_based_upgrade.sql).

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- USERS ROLE COLUMNS (SAFE UPGRADE)
-- -------------------------------------------------------------------
alter table public.users
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists role text default 'buyer',
  add column if not exists status text default 'active',
  add column if not exists is_verified boolean default false,
  add column if not exists avatar_url text,
  add column if not exists phone text,
  add column if not exists gender text,
  add column if not exists date_of_birth text,
  add column if not exists home_address text,
  add column if not exists office_address text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'users_role_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      drop constraint users_role_check;
  end if;

  alter table public.users
    add constraint users_role_check
    check (role in ('buyer', 'seller', 'agent', 'admin', 'owner', 'renter'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_status_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_status_check
      check (status in ('active', 'suspended'));
  end if;
exception
  when duplicate_object then null;
end
$$;

create unique index if not exists idx_users_email_unique
on public.users (lower(email))
where email is not null;

-- -------------------------------------------------------------------
-- AGENT PROFILE METRICS
-- -------------------------------------------------------------------
create table if not exists public.agent_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text,
  bio text,
  sales_rating numeric(3,2) not null default 0 check (sales_rating >= 0 and sales_rating <= 5),
  review_count integer not null default 0 check (review_count >= 0),
  recent_deals_count integer not null default 0 check (recent_deals_count >= 0),
  closed_deals_count integer not null default 0 check (closed_deals_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_profiles_sales_rating
on public.agent_profiles (sales_rating desc);

create or replace trigger trg_agent_profiles_updated_at
before update on public.agent_profiles
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- LISTINGS CORE TABLE
-- -------------------------------------------------------------------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  listing_code text unique,
  agent_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  listing_type text not null check (listing_type in ('sale', 'rent')),
  price numeric(14,2) not null check (price >= 0),
  price_suffix text check (price_suffix in ('/yr', '/mo') or price_suffix is null),
  location text not null,
  city text,
  state text,
  country text not null default 'Nigeria',
  bedrooms integer,
  bathrooms integer,
  property_size_sqm numeric(12,2),
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'published', 'rejected', 'archived', 'sold', 'rented')),
  views_count integer not null default 0 check (views_count >= 0),
  leads_count integer not null default 0 check (leads_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_listings_agent_id on public.listings (agent_id, created_at desc);
create index if not exists idx_listings_status on public.listings (status, created_at desc);
create index if not exists idx_listings_location on public.listings (location);

create or replace trigger trg_listings_updated_at
before update on public.listings
for each row
execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- LISTING STORAGE METADATA (IMAGES + DOCUMENTS)
-- -------------------------------------------------------------------
create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  file_path text not null,
  public_url text,
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_listing_images_listing_id
on public.listing_images (listing_id, sort_order, created_at);

create table if not exists public.listing_documents (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  document_type text not null
    check (
      document_type in (
        'title_document',
        'survey_plan',
        'ownership_authorization',
        'legal_document',
        'utility_bill',
        'identity',
        'other'
      )
    ),
  file_path text not null,
  public_url text,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_listing_documents_listing_id
on public.listing_documents (listing_id, created_at desc);

-- -------------------------------------------------------------------
-- PROPERTY VERIFICATION WORKFLOW
-- -------------------------------------------------------------------
create table if not exists public.listing_verification_cases (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'in_progress', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  reviewer_id uuid references public.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_listing_verification_cases_status
on public.listing_verification_cases (status, submitted_at desc);

create or replace trigger trg_listing_verification_cases_updated_at
before update on public.listing_verification_cases
for each row
execute function public.set_updated_at();

create table if not exists public.listing_verification_steps (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.listing_verification_cases(id) on delete cascade,
  step_key text not null
    check (
      step_key in (
        'ownership',
        'ownership_authorization',
        'survey',
        'right_of_way',
        'ministerial_charting',
        'legal_verification',
        'property_document_verification'
      )
    ),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'blocked')),
  notes text,
  checked_by uuid references public.users(id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, step_key)
);

create index if not exists idx_listing_verification_steps_case_id
on public.listing_verification_steps (case_id, created_at);

create or replace trigger trg_listing_verification_steps_updated_at
before update on public.listing_verification_steps
for each row
execute function public.set_updated_at();

create or replace function public.seed_listing_verification_steps()
returns trigger
language plpgsql
as $$
begin
  insert into public.listing_verification_steps (case_id, step_key, status)
  values
    (new.id, 'ownership', 'in_progress'),
    (new.id, 'ownership_authorization', 'pending'),
    (new.id, 'survey', 'pending'),
    (new.id, 'right_of_way', 'pending'),
    (new.id, 'ministerial_charting', 'pending'),
    (new.id, 'legal_verification', 'pending'),
    (new.id, 'property_document_verification', 'pending')
  on conflict (case_id, step_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_seed_listing_verification_steps on public.listing_verification_cases;
create trigger trg_seed_listing_verification_steps
after insert on public.listing_verification_cases
for each row
execute function public.seed_listing_verification_steps();

-- -------------------------------------------------------------------
-- IN-APP CHAT (ALL ROLES)
-- -------------------------------------------------------------------
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  subject text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_conversations
  add column if not exists scope text default 'listing',
  add column if not exists service_type text,
  add column if not exists status text default 'open',
  add column if not exists closed_at timestamptz,
  add column if not exists closed_reason text,
  add column if not exists record_folder text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_conversations_scope_check'
      and conrelid = 'public.chat_conversations'::regclass
  ) then
    alter table public.chat_conversations
      add constraint chat_conversations_scope_check
      check (scope in ('listing', 'renting', 'service', 'support'));
  end if;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_conversations_status_check'
      and conrelid = 'public.chat_conversations'::regclass
  ) then
    alter table public.chat_conversations
      add constraint chat_conversations_status_check
      check (status in ('open', 'closed'));
  end if;
exception
  when duplicate_object then null;
end
$$;

create index if not exists idx_chat_conversations_created_at
on public.chat_conversations (created_at desc);
create index if not exists idx_chat_conversations_listing_status
on public.chat_conversations (listing_id, status, updated_at desc);

create or replace trigger trg_chat_conversations_updated_at
before update on public.chat_conversations
for each row
execute function public.set_updated_at();

create table if not exists public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'participant' check (role in ('owner', 'participant', 'support')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists idx_chat_conversation_members_user
on public.chat_conversation_members (user_id, joined_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references public.users(id) on delete set null,
  message_type text not null default 'text' check (message_type in ('text', 'system', 'issue_card')),
  content text not null,
  problem_tag text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_conversation_created
on public.chat_messages (conversation_id, created_at desc);

-- -------------------------------------------------------------------
-- RECORD FOLDERS + DOCUMENT/BILLING FOUNDATIONS
-- -------------------------------------------------------------------
create table if not exists public.listing_record_folders (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  folder_root text not null unique,
  documents_folder text not null,
  contracts_folder text not null,
  chat_folder text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger trg_listing_record_folders_updated_at
before update on public.listing_record_folders
for each row
execute function public.set_updated_at();

create or replace function public.sync_listing_chat_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('sold', 'rented')
     and (old.status is distinct from new.status) then
    insert into public.listing_record_folders (
      listing_id,
      folder_root,
      documents_folder,
      contracts_folder,
      chat_folder,
      updated_at
    )
    values (
      new.id,
      concat('listings/', new.id::text),
      concat('listings/', new.id::text, '/documents'),
      concat('listings/', new.id::text, '/contracts'),
      concat('listings/', new.id::text, '/chat'),
      now()
    )
    on conflict (listing_id) do update
    set
      folder_root = excluded.folder_root,
      documents_folder = excluded.documents_folder,
      contracts_folder = excluded.contracts_folder,
      chat_folder = excluded.chat_folder,
      updated_at = now();

    update public.chat_conversations
    set
      status = 'closed',
      closed_at = now(),
      closed_reason = concat('listing_', new.status),
      record_folder = coalesce(record_folder, concat('listings/', new.id::text, '/chat')),
      updated_at = now()
    where listing_id = new.id
      and coalesce(status, 'open') <> 'closed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_listing_chat_lifecycle on public.listings;
create trigger trg_sync_listing_chat_lifecycle
after update of status on public.listings
for each row
execute function public.sync_listing_chat_lifecycle();

create table if not exists public.service_catalog (
  code text primary key,
  name text not null unique
);

insert into public.service_catalog (code, name) values
  ('land_surveying', 'Land Surveying'),
  ('snagging', 'Snagging'),
  ('real_estate_valuation', 'Property Valuation'),
  ('land_verification', 'Land Verification')
on conflict (code) do update set name = excluded.name;

create table if not exists public.service_request_records (
  id uuid primary key default gen_random_uuid(),
  service_code text not null references public.service_catalog(code),
  requester_id uuid not null references public.users(id) on delete cascade,
  provider_id uuid references public.users(id) on delete set null,
  conversation_id uuid unique references public.chat_conversations(id) on delete set null,
  folder_root text not null unique,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger trg_service_request_records_updated_at
before update on public.service_request_records
for each row
execute function public.set_updated_at();

create table if not exists public.conversation_file_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  bucket_id text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_file_attachments_conversation
on public.conversation_file_attachments (conversation_id, created_at desc);

create table if not exists public.conversation_transcripts (
  conversation_id uuid primary key references public.chat_conversations(id) on delete cascade,
  transcript_format text not null default 'pdf' check (transcript_format in ('pdf')),
  bucket_id text not null,
  storage_path text not null,
  generated_at timestamptz not null default now()
);

create table if not exists public.user_document_records (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  owner_user_id uuid references public.users(id) on delete set null,
  renter_user_id uuid references public.users(id) on delete set null,
  buyer_user_id uuid references public.users(id) on delete set null,
  seller_user_id uuid references public.users(id) on delete set null,
  agent_user_id uuid references public.users(id) on delete set null,
  document_type text not null check (document_type in ('contract', 'title', 'invoice', 'receipt', 'attachment', 'other')),
  bucket_id text not null,
  storage_path text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_document_records_listing
on public.user_document_records (listing_id, created_at desc);

create table if not exists public.utility_bills (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  owner_user_id uuid references public.users(id) on delete set null,
  renter_user_id uuid references public.users(id) on delete set null,
  bill_type text not null check (bill_type in ('electricity', 'water', 'waste_management', 'maintenance', 'other')),
  amount numeric(14,2) not null check (amount >= 0),
  billing_period_start date,
  billing_period_end date,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger trg_utility_bills_updated_at
before update on public.utility_bills
for each row
execute function public.set_updated_at();

create table if not exists public.property_expenses (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  owner_user_id uuid references public.users(id) on delete set null,
  category text not null check (category in ('maintenance', 'repairs', 'taxes', 'utilities', 'security', 'other')),
  amount numeric(14,2) not null check (amount >= 0),
  expense_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger trg_property_expenses_updated_at
before update on public.property_expenses
for each row
execute function public.set_updated_at();

create table if not exists public.permissions (
  code text primary key,
  description text not null
);

create table if not exists public.role_permissions (
  role text not null,
  permission_code text not null references public.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_code)
);

insert into public.permissions (code, description) values
  ('chat.use', 'Use in-app chat and conversation features'),
  ('chat.moderate', 'View and moderate all chat conversations'),
  ('documents.read', 'View property documents and contracts'),
  ('billing.read', 'View bills and expense records'),
  ('billing.manage', 'Manage bills and expense records')
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_code) values
  ('admin', 'chat.use'),
  ('admin', 'chat.moderate'),
  ('admin', 'documents.read'),
  ('admin', 'billing.read'),
  ('admin', 'billing.manage'),
  ('agent', 'chat.use'),
  ('agent', 'documents.read'),
  ('seller', 'chat.use'),
  ('seller', 'documents.read'),
  ('buyer', 'chat.use'),
  ('buyer', 'documents.read'),
  ('owner', 'chat.use'),
  ('owner', 'documents.read'),
  ('owner', 'billing.read'),
  ('owner', 'billing.manage'),
  ('renter', 'chat.use'),
  ('renter', 'documents.read'),
  ('renter', 'billing.read')
on conflict (role, permission_code) do nothing;

-- -------------------------------------------------------------------
-- STORAGE BUCKETS
-- -------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-images',
  'property-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-documents',
  'property-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
 20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'conversation-transcripts',
  'conversation-transcripts',
  false,
 10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-records',
  'service-records',
  false,
 20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'text/plain']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- -------------------------------------------------------------------
-- RLS + POLICIES (FOR FUTURE DIRECT FRONTEND ACCESS)
-- -------------------------------------------------------------------
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.listing_documents enable row level security;
alter table public.listing_verification_cases enable row level security;
alter table public.listing_verification_steps enable row level security;
alter table public.agent_profiles enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.listing_record_folders enable row level security;
alter table public.service_request_records enable row level security;
alter table public.conversation_file_attachments enable row level security;
alter table public.conversation_transcripts enable row level security;
alter table public.user_document_records enable row level security;
alter table public.utility_bills enable row level security;
alter table public.property_expenses enable row level security;

drop policy if exists listings_public_read on public.listings;
create policy listings_public_read
on public.listings
for select
using (status = 'published');

drop policy if exists listings_owner_admin_manage on public.listings;
create policy listings_owner_admin_manage
on public.listings
for all
using (
  agent_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  agent_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists listing_images_owner_admin_manage on public.listing_images;
create policy listing_images_owner_admin_manage
on public.listing_images
for all
using (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_images.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
)
with check (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_images.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists listing_documents_owner_admin_manage on public.listing_documents;
create policy listing_documents_owner_admin_manage
on public.listing_documents
for all
using (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_documents.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
)
with check (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_documents.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists listing_verification_cases_owner_admin_manage on public.listing_verification_cases;
create policy listing_verification_cases_owner_admin_manage
on public.listing_verification_cases
for all
using (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_verification_cases.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
)
with check (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_verification_cases.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists listing_verification_steps_owner_admin_manage on public.listing_verification_steps;
create policy listing_verification_steps_owner_admin_manage
on public.listing_verification_steps
for all
using (
  exists (
    select 1
    from public.listing_verification_cases c
    join public.listings l on l.id = c.listing_id
    left join public.users u on u.id = auth.uid()
    where c.id = listing_verification_steps.case_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
)
with check (
  exists (
    select 1
    from public.listing_verification_cases c
    join public.listings l on l.id = c.listing_id
    left join public.users u on u.id = auth.uid()
    where c.id = listing_verification_steps.case_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists agent_profiles_public_read on public.agent_profiles;
create policy agent_profiles_public_read
on public.agent_profiles
for select
using (true);

drop policy if exists agent_profiles_owner_admin_manage on public.agent_profiles;
create policy agent_profiles_owner_admin_manage
on public.agent_profiles
for all
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists chat_conversations_member_read on public.chat_conversations;
create policy chat_conversations_member_read
on public.chat_conversations
for select
using (
  exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = chat_conversations.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists chat_conversations_member_create on public.chat_conversations;
create policy chat_conversations_member_create
on public.chat_conversations
for insert
with check (
  auth.uid() = created_by
  and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'agent', 'seller', 'buyer', 'owner', 'renter')
  )
);

drop policy if exists chat_conversations_owner_update on public.chat_conversations;
create policy chat_conversations_owner_update
on public.chat_conversations
for update
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  created_by = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists chat_members_member_read on public.chat_conversation_members;
create policy chat_members_member_read
on public.chat_conversation_members
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = chat_conversation_members.conversation_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists chat_members_owner_manage on public.chat_conversation_members;
create policy chat_members_owner_manage
on public.chat_conversation_members
for all
using (
  exists (
    select 1
    from public.chat_conversations c
    left join public.users u on u.id = auth.uid()
    where c.id = chat_conversation_members.conversation_id
      and (c.created_by = auth.uid() or u.role = 'admin')
  )
)
with check (
  exists (
    select 1
    from public.chat_conversations c
    left join public.users u on u.id = auth.uid()
    where c.id = chat_conversation_members.conversation_id
      and (c.created_by = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists chat_messages_member_read on public.chat_messages;
create policy chat_messages_member_read
on public.chat_messages
for select
using (
  exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = chat_messages.conversation_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists chat_messages_member_insert on public.chat_messages;
create policy chat_messages_member_insert
on public.chat_messages
for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = chat_messages.conversation_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists listing_record_folders_owner_admin_manage on public.listing_record_folders;
create policy listing_record_folders_owner_admin_manage
on public.listing_record_folders
for all
using (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_record_folders.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
)
with check (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_record_folders.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists service_request_records_member_access on public.service_request_records;
create policy service_request_records_member_access
on public.service_request_records
for all
using (
  requester_id = auth.uid()
  or provider_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  requester_id = auth.uid()
  or provider_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists conversation_file_attachments_member_access on public.conversation_file_attachments;
create policy conversation_file_attachments_member_access
on public.conversation_file_attachments
for all
using (
  exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = conversation_file_attachments.conversation_id
      and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  uploaded_by = auth.uid()
  and (
    exists (
      select 1
      from public.chat_conversation_members m
      where m.conversation_id = conversation_file_attachments.conversation_id
        and m.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
    )
  )
);

drop policy if exists conversation_transcripts_member_read on public.conversation_transcripts;
create policy conversation_transcripts_member_read
on public.conversation_transcripts
for select
using (
  exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = conversation_transcripts.conversation_id
      and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists conversation_transcripts_admin_manage on public.conversation_transcripts;
create policy conversation_transcripts_admin_manage
on public.conversation_transcripts
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists user_document_records_role_read on public.user_document_records;
create policy user_document_records_role_read
on public.user_document_records
for select
using (
  owner_user_id = auth.uid()
  or renter_user_id = auth.uid()
  or buyer_user_id = auth.uid()
  or seller_user_id = auth.uid()
  or agent_user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists user_document_records_admin_manage on public.user_document_records;
create policy user_document_records_admin_manage
on public.user_document_records
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists utility_bills_role_access on public.utility_bills;
create policy utility_bills_role_access
on public.utility_bills
for all
using (
  owner_user_id = auth.uid()
  or renter_user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  owner_user_id = auth.uid()
  or renter_user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists property_expenses_owner_admin_access on public.property_expenses;
create policy property_expenses_owner_admin_access
on public.property_expenses
for all
using (
  owner_user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  owner_user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists property_images_public_read on storage.objects;
create policy property_images_public_read
on storage.objects
for select
using (bucket_id = 'property-images');

drop policy if exists property_images_authenticated_insert on storage.objects;
create policy property_images_authenticated_insert
on storage.objects
for insert
with check (
  bucket_id = 'property-images'
  and auth.role() = 'authenticated'
);

drop policy if exists property_images_owner_update on storage.objects;
create policy property_images_owner_update
on storage.objects
for update
using (
  bucket_id = 'property-images'
  and owner::text = auth.uid()::text
)
with check (
  bucket_id = 'property-images'
  and owner::text = auth.uid()::text
);

drop policy if exists property_images_owner_delete on storage.objects;
create policy property_images_owner_delete
on storage.objects
for delete
using (
  bucket_id = 'property-images'
  and owner::text = auth.uid()::text
);

drop policy if exists property_documents_authenticated_read on storage.objects;
create policy property_documents_authenticated_read
on storage.objects
for select
using (
  bucket_id = 'property-documents'
  and auth.role() = 'authenticated'
);

drop policy if exists property_documents_authenticated_insert on storage.objects;
create policy property_documents_authenticated_insert
on storage.objects
for insert
with check (
  bucket_id = 'property-documents'
  and auth.role() = 'authenticated'
);

drop policy if exists property_documents_owner_update on storage.objects;
create policy property_documents_owner_update
on storage.objects
for update
using (
  bucket_id = 'property-documents'
  and owner::text = auth.uid()::text
)
with check (
  bucket_id = 'property-documents'
  and owner::text = auth.uid()::text
);

drop policy if exists property_documents_owner_delete on storage.objects;
create policy property_documents_owner_delete
on storage.objects
for delete
using (
  bucket_id = 'property-documents'
  and owner::text = auth.uid()::text
);

drop policy if exists chat_attachments_authenticated_read on storage.objects;
create policy chat_attachments_authenticated_read
on storage.objects
for select
using (
  bucket_id in ('chat-attachments', 'service-records', 'conversation-transcripts')
  and auth.role() = 'authenticated'
);

drop policy if exists chat_attachments_authenticated_insert on storage.objects;
create policy chat_attachments_authenticated_insert
on storage.objects
for insert
with check (
  bucket_id in ('chat-attachments', 'service-records', 'conversation-transcripts')
  and auth.role() = 'authenticated'
);

drop policy if exists chat_attachments_owner_update on storage.objects;
create policy chat_attachments_owner_update
on storage.objects
for update
using (
  bucket_id in ('chat-attachments', 'service-records', 'conversation-transcripts')
  and owner::text = auth.uid()::text
)
with check (
  bucket_id in ('chat-attachments', 'service-records', 'conversation-transcripts')
  and owner::text = auth.uid()::text
);

drop policy if exists chat_attachments_owner_delete on storage.objects;
create policy chat_attachments_owner_delete
on storage.objects
for delete
using (
  bucket_id in ('chat-attachments', 'service-records', 'conversation-transcripts')
  and owner::text = auth.uid()::text
);
