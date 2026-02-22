-- Justice City: add address fields for identity verification records.
-- Run this in Supabase SQL Editor for existing environments.

alter table if exists public.verifications
  add column if not exists home_address text,
  add column if not exists office_address text;

