-- Justice City - Verification Documents Storage + Schema Extension
-- Safe to run multiple times.
--
-- Purpose:
-- 1) Add private bucket for KYC verification documents.
-- 2) Extend public.verification_documents with storage metadata fields.
-- 3) Add storage RLS policies for verification-documents bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-documents',
  'verification-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.verification_documents
  add column if not exists bucket_id text default 'verification-documents',
  add column if not exists storage_path text,
  add column if not exists uploaded_by uuid references public.users(id) on delete set null,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint;

-- Keep legacy rows usable in UI by backfilling missing storage path from document_url when possible.
update public.verification_documents
set storage_path = document_url
where storage_path is null
  and document_url is not null
  and document_url <> ''
  and document_url not like 'http%';

create index if not exists idx_verification_documents_storage_path
on public.verification_documents (bucket_id, storage_path);

drop policy if exists verification_documents_authenticated_read on storage.objects;
create policy verification_documents_authenticated_read
on storage.objects
for select
using (
  bucket_id = 'verification-documents'
  and auth.role() = 'authenticated'
);

drop policy if exists verification_documents_authenticated_insert on storage.objects;
create policy verification_documents_authenticated_insert
on storage.objects
for insert
with check (
  bucket_id = 'verification-documents'
  and auth.role() = 'authenticated'
);

drop policy if exists verification_documents_owner_update on storage.objects;
create policy verification_documents_owner_update
on storage.objects
for update
using (
  bucket_id = 'verification-documents'
  and owner::text = auth.uid()::text
)
with check (
  bucket_id = 'verification-documents'
  and owner::text = auth.uid()::text
);

drop policy if exists verification_documents_owner_delete on storage.objects;
create policy verification_documents_owner_delete
on storage.objects
for delete
using (
  bucket_id = 'verification-documents'
  and owner::text = auth.uid()::text
);

