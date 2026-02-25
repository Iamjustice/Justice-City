# Cross-Stack QA / Regression Checklist

Date: February 25, 2026  
Branch: `rollout/day07-patch07-permissions-role-gating`

## 1) Web + Server Static Validation (Completed)

- `npm run check`  
  Result: pass
- `npm run ci:contract`  
  Result: pass (`guard:supabase`)
- `npm run build`  
  Result: pass (client + server bundle)

## 1b) Mobile Validation (Completed)

- Workdir: `C:\Users\hp\Desktop\Justice-City-Mobile`
- `flutter analyze`  
  Result: pass (no issues)
- `flutter test`  
  Result: pass (`test/widget_test.dart`)

## 2) Permission Gating Smoke (Completed in Code + Build)

Validated by route protection and type/build checks:

- Admin dashboard now uses bearer-auth `apiRequest` for admin endpoints.
- Admin endpoints enforce DB-backed permissions from `role_permissions` (with fallback map when table is unavailable).
- UI actions are hidden/disabled based on `user.permissions`.

Core gated paths:

- `/api/admin/dashboard` -> `users.read`
- `/api/admin/hiring-applications` + status updates -> `users.manage`
- `/api/admin/verifications/:id` -> `verifications.review`
- `/api/admin/flagged-listings/:id/status` -> `flagged.manage`
- `/api/admin/flagged-listings/:id/comments` -> `flagged.comment`
- `/api/admin/chat/conversations` -> `chat.moderate`
- `/api/disputes/open` + `/api/disputes/:id/resolve` -> `chat.moderate`
- `/api/service-pdf-jobs/process-next` -> `chat.moderate`
- `/api/payout-ledger/:entryId/status` -> `commissions.manage`

## 3) Admin Ops Parity (Completed)

UI added/confirmed:

- Open disputes queue in admin dashboard
- Resolve/reject/cancel controls for disputes
- Manual "Process Next Job" action for service PDF jobs
- Conversation moderation panel still available for action-card resolution flow

## 4) Supabase Contract Checks (Completed)

- Environment contract enforcement script executed successfully.
- No service-role key usage in client/mobile source paths (enforced by `guard:supabase`).

## 5) Manual Runtime Checks (Pending in live/staging)

Run these in staging or production-like environment:

1. Admin can open `/dashboard` and load all admin cards.
2. Non-admin user is denied admin-only actions with clear UI message.
3. Open dispute from chat, then resolve from admin queue.
4. Trigger `Process Next Job` and confirm PDF job status transition.
5. Confirm no regressions on listing, verification, and hiring dashboards.

## 6) SQL Verification Checklist (Pending live DB confirmation)

Confirm in Supabase:

1. `role_permissions` contains expected permission rows for `admin`.
2. `service_pdf_jobs` table receives queued/processed updates.
3. `transaction_disputes` rows transition from `open` -> `resolved/rejected/cancelled`.
4. `transaction_status_history` and `payout_ledger` continue writing correctly.
