-- Justice City - Email OTP Storage
-- Safe to run multiple times.
--
-- Purpose:
-- Persist email OTP codes/hashes with expiry for multi-instance verification flow.

create table if not exists public.verification_email_otps (
  email_key text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_verification_email_otps_expires_at
on public.verification_email_otps (expires_at);

create index if not exists idx_verification_email_otps_updated_at
on public.verification_email_otps (updated_at desc);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at'
      and n.nspname = 'public'
  ) then
    drop trigger if exists trg_verification_email_otps_updated_at on public.verification_email_otps;
    create trigger trg_verification_email_otps_updated_at
    before update on public.verification_email_otps
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;

