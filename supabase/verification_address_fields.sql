-- Justice City: add verification/profile fields used by onboarding.
-- Run this in Supabase SQL Editor for existing environments.

alter table if exists public.verifications
  add column if not exists home_address text,
  add column if not exists office_address text,
  add column if not exists date_of_birth text;

alter table if exists public.users
  add column if not exists home_address text,
  add column if not exists office_address text,
  add column if not exists date_of_birth text,
  add column if not exists gender text;
