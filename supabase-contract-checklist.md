# Supabase Contract Checklist

This project uses one shared Supabase backend for web and mobile clients, with server-side privileged access.

## Required Model

1. Web (`client`) and mobile clients use `SUPABASE_URL` + anon key only.
2. Clients authenticate with Supabase and send user JWTs to Node API.
3. Node API uses `SUPABASE_SERVICE_ROLE_KEY` server-side only.
4. Supabase SQL migrations in `supabase/*.sql` remain schema source of truth.
5. RLS/policies must support all active clients consistently.

## Secrets Safety

1. Never reference `SUPABASE_SERVICE_ROLE_KEY` in client/mobile source code.
2. Keep service key only in backend runtime env, never in browser/mobile bundles.
3. Do not hardcode Supabase secrets in any committed file.

## Environment Contract

Required keys in `.env.example`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## CI Guardrails

CI must fail when:

1. Required Supabase keys are missing from `.env.example`.
2. Contract-prefixed keys exist in `.env` but not in `.env.example` (env drift).
3. `SUPABASE_SERVICE_ROLE_KEY` appears in frontend/mobile code paths.

## Manual Release Checks

Before production release:

1. Confirm clients point to the same Supabase project URL.
2. Confirm backend has service key configured in deployment env.
3. Confirm no service key string appears in `client/`, `mobile/`, `android/`, `ios/`, or `lib/`.
4. Run:

```bash
npm run guard:supabase
npm run check
npm run build
```
