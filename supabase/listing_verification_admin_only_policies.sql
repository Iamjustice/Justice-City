-- Justice City: lock listing verification workflow to admins only.
-- Run this in Supabase SQL Editor for existing environments.
-- Safe to run multiple times.

alter table if exists public.listing_verification_cases enable row level security;
alter table if exists public.listing_verification_steps enable row level security;

drop policy if exists listing_verification_cases_owner_admin_manage on public.listing_verification_cases;
drop policy if exists listing_verification_cases_owner_admin_read on public.listing_verification_cases;
create policy listing_verification_cases_owner_admin_read
on public.listing_verification_cases
for select
using (
  exists (
    select 1
    from public.listings l
    left join public.users u on u.id = auth.uid()
    where l.id = listing_verification_cases.listing_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists listing_verification_cases_admin_manage on public.listing_verification_cases;
create policy listing_verification_cases_admin_manage
on public.listing_verification_cases
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

drop policy if exists listing_verification_steps_owner_admin_manage on public.listing_verification_steps;
drop policy if exists listing_verification_steps_owner_admin_read on public.listing_verification_steps;
create policy listing_verification_steps_owner_admin_read
on public.listing_verification_steps
for select
using (
  exists (
    select 1
    from public.listing_verification_cases c
    join public.listings l on l.id = c.listing_id
    left join public.users u on u.id = auth.uid()
    where c.id = listing_verification_steps.case_id
      and (l.agent_id = auth.uid() or u.role = 'admin')
  )
);

drop policy if exists listing_verification_steps_admin_manage on public.listing_verification_steps;
create policy listing_verification_steps_admin_manage
on public.listing_verification_steps
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
