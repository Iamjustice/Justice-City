# Strict Mode Rollout Guide (Non-Technical)

## Purpose
This guide explains how to move from "backup/fallback" behavior to fully database-backed behavior in production, without breaking user flows.

## Is there a button for this today?
No. There is currently no dashboard button that turns strict mode on/off.

Today, this is a release setting controlled by engineering during deployment.

## What strict mode means (simple)
- Before: if some records are missing, the app can show backup values.
- After: app only trusts real database records.
- If data is missing, app shows a clear "data missing" state instead of guessed values.

## Safe rollout plan

### Step 1: Data readiness check (before switch)
Confirm all active listings have complete verification records in the database.

Checklist:
- No live listing IDs like `prop_*` in API responses.
- Every listing under review has one row in `listing_verification_cases`.
- Every case has expected rows in `listing_verification_steps`.

### Step 2: Enable strict mode (release switch)
Engineering enables strict mode in production deployment settings.

Result:
- Fallback reads are blocked.
- Missing DB rows show explicit status (not fake progress).

### Step 3: Observe for 24-48 hours
Monitor error logs and support tickets.

Watch for:
- "verification case missing"
- "verification steps missing"
- status/load failures on dashboards

### Step 4: Clean-up release
Once stable, engineering removes fallback code entirely.

## Rollback plan
If issues appear after strict mode is enabled:
1. Turn strict mode off.
2. Backfill missing DB rows.
3. Re-enable strict mode after verification.

## Recommended user-facing label (instead of "not initialized")
Pick one:
- "Verification setup pending"
- "Verification record pending"
- "Verification data not available yet"
- "Admin review setup pending"

Recommended default: **"Verification setup pending"**

## Ownership
- Product/Operations: approve switch window.
- Engineering: toggle strict mode + monitor logs.
- Support: track and report affected listing IDs.