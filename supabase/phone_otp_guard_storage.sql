-- Justice City - Persistent Phone OTP Guard Storage
-- Safe to run multiple times.
--
-- Purpose:
-- Store OTP cooldown/rate-limit/attempt state in Postgres so limits survive
-- server restarts and work across multiple app instances.
--
-- Notes:
-- - phone_key is a server-generated hash (not raw phone number).
-- - phone_last4 is optional for support visibility.

create table if not exists public.phone_otp_guards (
  phone_key text primary key,
  phone_last4 text,
  last_sent_at timestamptz,
  send_window_started_at timestamptz,
  sends_in_window integer not null default 0 check (sends_in_window >= 0),
  failed_verify_attempts integer not null default 0 check (failed_verify_attempts >= 0),
  verify_blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_phone_otp_guards_verify_blocked_until
on public.phone_otp_guards (verify_blocked_until);

create index if not exists idx_phone_otp_guards_updated_at
on public.phone_otp_guards (updated_at desc);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at'
      and n.nspname = 'public'
  ) then
    drop trigger if exists trg_phone_otp_guards_updated_at on public.phone_otp_guards;
    create trigger trg_phone_otp_guards_updated_at
    before update on public.phone_otp_guards
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;

