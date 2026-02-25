# Strict DB Mode Implementation Document

## Goal
Move listing verification progress and related dashboard state to strict database-backed behavior.

## Current state (as of Feb 25, 2026)
- Fallback paths still exist in server repositories (listings/admin/chat/services).
- No dedicated UI toggle exists for strict mode.
- Strict behavior should be controlled by server config, not client-side switch.

## Design decision
Use a backend environment flag:
- `STRICT_DB_MODE=true|false`

Rules:
- `false` (default during migration): fallback permitted.
- `true` (production strict): fallback disabled for verification/listing status sources.

## Scope
Primary strictization targets:
1. `server/listing-repository.ts`
2. `server/admin-repository.ts`
3. `server/routes.ts` endpoints that currently derive/backfill verification fields from fallback paths.

Out of scope for first strict patch:
- Smile callback internals
- unrelated chat/service feature fallbacks not tied to listing verification progress

## Behavior contract in strict mode
When DB data is missing:
- API returns deterministic error with actionable message.
- No synthetic verification progress is generated.

Recommended response shape:

```json
{
  "message": "Verification setup pending",
  "code": "VERIFICATION_SETUP_MISSING",
  "listingId": "..."
}
```

Suggested status codes:
- `409` for incomplete required setup
- `404` for missing listing/case
- `403` for access issues

## Implementation steps

### 1) Add config helper
Create server config accessor:
- `isStrictDbModeEnabled(): boolean`
- Reads `STRICT_DB_MODE` (true/1/yes => enabled)

### 2) Gate fallback branches
In each relevant fallback branch:
- If strict mode ON: throw structured setup error
- If strict mode OFF: keep existing fallback behavior

### 3) Keep UI stable
Frontend/mobile should map `VERIFICATION_SETUP_MISSING` to user-friendly text:
- "Verification setup pending"

### 4) Logging
Emit warning logs with identifiers:
- `listingId`
- `actorUserId`
- missing component (`case` or `steps`)

### 5) Rollout
- Release A: add flag + strict branch behavior (default OFF)
- Release B: set ON in production
- Release C: remove dead fallback code after 24-48h stable window

## Validation checklist

Before enabling strict mode in production:
- SQL checks confirm coverage in:
  - `listing_verification_cases`
  - `listing_verification_steps`
- No live `prop_*` IDs in listing APIs.

After enabling:
- Dashboard loads still succeed for complete records.
- Missing records return `VERIFICATION_SETUP_MISSING`.
- No synthetic step completion appears.

## CI guard extension (recommended)
Add a CI check script that fails if new fallback branches are added under strictized modules without flag guard.

## Future enhancement: optional admin toggle UI
If you need a UI control later:
- Add admin-only settings page toggle.
- Toggle writes to secure backend config (not public env).
- Audit-log every strict-mode change.

Do not add this until core strict mode is stable.