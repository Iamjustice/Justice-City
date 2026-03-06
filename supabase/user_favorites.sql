-- User-scoped saved listings/favorites
-- Run this in Supabase SQL editor before using /api/favorites endpoints.

create table if not exists public.user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  listing_id text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists user_favorites_user_listing_uidx
  on public.user_favorites(user_id, listing_id);

create index if not exists user_favorites_user_created_idx
  on public.user_favorites(user_id, created_at desc);
