# Supabase Setup (Justice City)

This project uses Supabase for backend persistence of users and Smile ID verification jobs.

## 1) Create a Supabase project
1. Open your Supabase dashboard.
2. Create a new project.
3. Copy:
   - `Project URL` -> `SUPABASE_URL`
   - `service_role` key -> `SUPABASE_SERVICE_ROLE_KEY`

## 2) Create database objects
Run `supabase/schema.sql` in the Supabase SQL editor.

This creates:
- `public.users`
- `public.verifications`
- `public.verification_documents`
- `public.flagged_listings`
- `public.flagged_listing_comments`
- `public.admin_chat_cards`
- `public.revenue_records`
- `public.set_updated_at()` trigger function
- `public.update_verification_status(...)` helper function
- `public.verification_summary` view

If your project already exists and you need role-based columns/tables added safely, run:
- `supabase/role_based_upgrade.sql`
- `supabase/role_owner_renter_permissions.sql` (run this immediately after `role_based_upgrade.sql`)

If your project was bootstrapped before `verifications.user_id` was UUID-based, run:
- `supabase/verifications_user_id_uuid_upgrade.sql`

If you are implementing the full agent listing workflow (agent roles, listings, verification steps, and storage buckets), also run:
- `supabase/agent_roles_listings_storage.sql`

If you want admin-managed professional service pricing and delivery timelines, also run:
- `supabase/service_offerings_admin.sql`

If you want hiring applications persisted for the `/hiring` page and admin review workflow, also run:
- `supabase/professional_hiring_applications.sql`

If you want automatic commission calculation whenever a listing is closed (`sold`/`rented`), also run:
- `supabase/commission_automation.sql`

If you previously tested service chats and want canonical service folder roots plus cleanup tooling:
- `supabase/migrate_service_folder_paths.sql` (normalize existing DB path metadata)
- `supabase/clear_service_test_data.sql` (delete service test records + linked storage objects)

That upgrade script is idempotent and adds:
- role/status columns to `public.users`
- role-permission tables/functions (`permissions`, `role_permissions`, `user_has_role`, `user_has_permission`) including `chat.use` and `chat.moderate`
- all admin workflow tables if missing (`verification_documents`, `flagged_listings`, `flagged_listing_comments`, `admin_chat_cards`, `revenue_records`)
- role expansion support for `owner` and `renter` in addition to `buyer`, `seller`, `agent`, `admin`

Important note for Supabase SQL editor:
- If you see `ERROR: 55P04 unsafe use of new value ... of enum type user_role`, run scripts in this order:
1. `supabase/role_based_upgrade.sql`
2. `supabase/role_owner_renter_permissions.sql`

The agent workflow script is idempotent and adds:
- `public.agent_profiles` (ratings/reviews/recent and closed deals counters)
- `public.listings`
- `public.listing_images`
- `public.listing_documents`
- `public.listing_verification_cases`
- `public.listing_verification_steps`
- in-app chat tables: `public.chat_conversations`, `public.chat_conversation_members`, `public.chat_messages`
- chat lifecycle/status columns for `public.chat_conversations` (open/closed + closure metadata)
- role permissions ensuring all roles (`admin`, `agent`, `seller`, `buyer`, `owner`, `renter`) can use in-app chat (`chat.use`)
- `public.listing_record_folders` for listing-level folderized record management
- service and records foundations: `public.service_catalog`, `public.service_request_records`
- chat files/transcript tables: `public.conversation_file_attachments`, `public.conversation_transcripts`
- document and billing foundations: `public.user_document_records`, `public.utility_bills`, `public.property_expenses`
- storage buckets: `property-images`, `property-documents`
- RLS policies for listing and storage access

The commission automation script is idempotent and adds:
- `public.commission_policies` (default: total 5%, agent 60%, company 40%)
- `public.listing_commissions` ledger
- trigger `trg_sync_listing_commission` on `public.listings`
- auto company revenue insertion/upsert into `public.revenue_records`
- summary views: `public.listing_commission_summary`, `public.company_commission_monthly`
- automatic agent closed-deal counters refresh in `public.agent_profiles`
- permission codes: `commissions.read`, `commissions.manage` (when `permissions` tables exist)

Commission formula used by default policy:
- `total_commission = close_amount * 0.05`
- `agent_commission = total_commission * 0.60`
- `company_commission = total_commission * 0.40`

The service offerings script is idempotent and adds:
- `public.service_offerings` with editable `price_label` and `turnaround_label`
- seeded default offerings for:
  - `land_surveying`
  - `real_estate_valuation` (user-facing label: Property Valuation)
  - `land_verification`
  - `snagging`
- RLS policies allowing public reads and admin updates

The hiring applications script is idempotent and adds:
- `public.professional_hiring_applications`
- status workflow (`submitted`, `under_review`, `approved`, `rejected`)
- applicant and reviewer linkage to `public.users`
- consent tracking (`consented_to_checks`, `consented_at`)
- RLS policies for self-submission/read and admin management

## 3) Configure environment variables
Use `.env.example` and set these required values:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMILE_ID_PARTNER_ID`
- `SMILE_ID_API_KEY`

Optional overrides:
- `SUPABASE_USERS_TABLE`
- `SUPABASE_VERIFICATIONS_TABLE`
- `SUPABASE_VERIFICATION_DOCUMENTS_TABLE`
- `SUPABASE_FLAGGED_LISTINGS_TABLE`
- `SUPABASE_FLAGGED_LISTING_COMMENTS_TABLE`
- `SUPABASE_ADMIN_CHAT_CARDS_TABLE`
- `SUPABASE_REVENUE_RECORDS_TABLE`
- `SUPABASE_LISTINGS_TABLE`
- `SUPABASE_LISTING_IMAGES_TABLE`
- `SUPABASE_LISTING_DOCUMENTS_TABLE`
- `SUPABASE_LISTING_VERIFICATION_CASES_TABLE`
- `SUPABASE_LISTING_VERIFICATION_STEPS_TABLE`
- `SUPABASE_LISTING_COMMISSIONS_TABLE`
- `SUPABASE_COMMISSION_POLICIES_TABLE`
- `SUPABASE_CHAT_CONVERSATIONS_TABLE`
- `SUPABASE_CHAT_CONVERSATION_MEMBERS_TABLE`
- `SUPABASE_CHAT_MESSAGES_TABLE`
- `SUPABASE_SERVICE_CATALOG_TABLE`
- `SUPABASE_SERVICE_REQUESTS_TABLE`
- `SUPABASE_CONVERSATION_ATTACHMENTS_TABLE`
- `SUPABASE_CONVERSATION_TRANSCRIPTS_TABLE`
- `SUPABASE_SERVICE_OFFERINGS_TABLE`
- `SUPABASE_HIRING_APPLICATIONS_TABLE`
- `SMILE_ID_CALLBACK_URL`
- `SMILE_ID_BASE_URL`
- `SMILE_ID_KYC_PATH`
- `SMILE_ID_BIOMETRIC_PATH`

## 4) Storage behavior
- If Supabase env vars are present, server storage uses Supabase.
- If not present, the app falls back to in-memory storage for local mock mode.

## 5) Smile ID callback wiring
Set Smile ID callback URL to:

`POST /api/verification/smile-id/callback`

Example local URL:
`http://localhost:5000/api/verification/smile-id/callback`


Production callback URL for this project:
`https://justicecityltd.com/api/verification/smile-id/callback`
