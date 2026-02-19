-- Justice City: normalize public.verifications.user_id from text -> uuid
-- Run this once on existing environments created before the UUID fix.
--
-- What this does:
-- 1) Archives invalid/orphaned verification rows into an audit table.
-- 2) Converts verifications.user_id to uuid.
-- 3) Enforces FK to public.users(id) with on delete cascade.

do $$
begin
  if to_regclass('public.verifications') is null then
    raise notice 'public.verifications does not exist; nothing to migrate.';
    return;
  end if;

  if to_regclass('public.users') is null then
    raise exception 'public.users does not exist; create users table before this migration.';
  end if;
end
$$;

create table if not exists public.verifications_user_id_migration_rejects (
  id uuid primary key,
  original_user_id text,
  reason text not null,
  payload jsonb not null,
  moved_at timestamptz not null default now()
);

with problematic as (
  select
    v.id,
    v.user_id::text as original_user_id,
    case
      when coalesce(trim(v.user_id::text), '') = '' then 'empty user_id'
      when trim(v.user_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then 'invalid uuid format'
      else 'orphaned user reference'
    end as reason,
    to_jsonb(v) as payload
  from public.verifications v
  where
    coalesce(trim(v.user_id::text), '') = ''
    or trim(v.user_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or not exists (
      select 1
      from public.users u
      where u.id::text = trim(v.user_id::text)
    )
),
archived as (
  insert into public.verifications_user_id_migration_rejects (
    id,
    original_user_id,
    reason,
    payload
  )
  select
    p.id,
    p.original_user_id,
    p.reason,
    p.payload
  from problematic p
  on conflict (id) do update
  set
    original_user_id = excluded.original_user_id,
    reason = excluded.reason,
    payload = excluded.payload,
    moved_at = now()
  returning id
)
delete from public.verifications v
using archived a
where v.id = a.id;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'verifications'
      and column_name = 'user_id'
      and udt_name <> 'uuid'
  ) then
    alter table public.verifications
      alter column user_id type uuid
      using nullif(trim(user_id::text), '')::uuid;
  end if;
end
$$;

alter table public.verifications
  alter column user_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.verifications'::regclass
      and c.conname = 'verifications_user_id_fkey'
  ) then
    alter table public.verifications
      add constraint verifications_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;
end
$$;

create index if not exists idx_verifications_user_id
on public.verifications (user_id);
