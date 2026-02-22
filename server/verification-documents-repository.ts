import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateUtilityBillAddress,
  isUtilityBillAddressMatchEnforced,
  type UtilityBillAddressEvaluationResult,
} from "./utility-bill-address";

const VERIFICATIONS_TABLE = process.env.SUPABASE_VERIFICATIONS_TABLE || "verifications";
const VERIFICATION_DOCUMENTS_TABLE =
  process.env.SUPABASE_VERIFICATION_DOCUMENTS_TABLE || "verification_documents";
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";
const VERIFICATION_DOCUMENTS_BUCKET =
  process.env.SUPABASE_VERIFICATION_DOCUMENTS_BUCKET || "verification-documents";
const VERIFICATION_DOCUMENT_SIGNED_URL_TTL_SEC = Number.parseInt(
  String(process.env.VERIFICATION_DOCUMENT_SIGNED_URL_TTL_SEC ?? "3600"),
  10,
) || 3600;
const VERIFICATION_DOCUMENT_MAX_SIZE_BYTES = Number.parseInt(
  String(process.env.VERIFICATION_DOCUMENT_MAX_SIZE_BYTES ?? String(10 * 1024 * 1024)),
  10,
) || 10 * 1024 * 1024;

const ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type UploadVerificationDocumentInput = {
  userId: string;
  documentType: string;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
  contentBase64: string;
  verificationId?: string;
  homeAddress?: string;
  officeAddress?: string;
  dateOfBirth?: string;
};

type UploadVerificationDocumentResult = {
  verificationId: string;
  documentId: string;
  bucketId: string;
  storagePath: string;
  previewUrl?: string;
  addressMatch?: UtilityBillAddressEvaluationResult;
};

type Base64Payload = {
  buffer: Buffer;
  mimeType?: string;
};

export class VerificationDocumentValidationError extends Error {
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "VerificationDocumentValidationError";
    this.details = details;
  }
}

function getClient(): SupabaseClient | null {
  const url = String(process.env.SUPABASE_URL ?? "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingTableOrColumnError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  if (!message) return false;
  return (
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function sanitizeStorageFileName(value: string): string {
  const safe = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || "document.bin";
}

function normalizeDocumentType(rawValue: string): string {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return value || "identity";
}

function normalizeAddress(rawValue: unknown): string | undefined {
  const normalized = String(rawValue ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, 500);
}

function normalizeDateOfBirth(rawValue: unknown): string | undefined {
  const normalized = String(rawValue ?? "").trim();
  if (!normalized) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function parseBase64Payload(input: string): Base64Payload {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("contentBase64 is required.");
  }

  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    const mimeType = String(dataUrlMatch[1] ?? "").trim().toLowerCase();
    const encoded = String(dataUrlMatch[2] ?? "").trim();
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length) {
      throw new Error("Document payload is empty.");
    }
    return { buffer, mimeType: mimeType || undefined };
  }

  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) {
    throw new Error("Document payload is empty.");
  }
  return { buffer };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

async function ensureVerificationRecord(
  client: SupabaseClient,
  userId: string,
  requestedVerificationId?: string,
): Promise<string> {
  const normalizedVerificationId = String(requestedVerificationId ?? "").trim();

  if (normalizedVerificationId && isUuid(normalizedVerificationId)) {
    const { data: existing, error: existingError } = await client
      .from(VERIFICATIONS_TABLE)
      .select("id")
      .eq("id", normalizedVerificationId)
      .eq("user_id", userId)
      .maybeSingle<{ id: string }>();

    if (existingError && !isMissingTableOrColumnError(existingError)) {
      throw new Error(`Failed to load verification record: ${existingError.message}`);
    }
    if (existing?.id) return String(existing.id);
  }

  const { data: latest, error: latestError } = await client
    .from(VERIFICATIONS_TABLE)
    .select("id, status")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status?: string | null }>();

  if (latestError && !isMissingTableOrColumnError(latestError)) {
    throw new Error(`Failed to load latest verification record: ${latestError.message}`);
  }

  if (latest?.id && String(latest.status ?? "").toLowerCase() === "pending") {
    return String(latest.id);
  }

  const draftJobId = `prefill-${randomUUID()}`;
  const { data: created, error: createError } = await client
    .from(VERIFICATIONS_TABLE)
    .insert({
      user_id: userId,
      mode: "kyc",
      provider: "mock",
      status: "pending",
      job_id: draftJobId,
      message: "Verification documents uploaded. Awaiting biometric submission.",
    })
    .select("id")
    .single<{ id: string }>();

  if (createError || !created?.id) {
    throw new Error(`Failed to create draft verification record: ${createError?.message ?? "No data returned"}`);
  }

  return String(created.id);
}

async function persistVerificationAddressDetails(
  client: SupabaseClient,
  input: {
    verificationId: string;
    userId: string;
    homeAddress?: string;
    officeAddress?: string;
    dateOfBirth?: string;
  },
): Promise<void> {
  const verificationUpdates: Record<string, string | null> = {};
  const userUpdates: Record<string, string | null> = {};
  if (typeof input.homeAddress === "string" && input.homeAddress.trim().length > 0) {
    const normalized = input.homeAddress.trim();
    verificationUpdates.home_address = normalized;
    userUpdates.home_address = normalized;
  }
  if (typeof input.officeAddress === "string" && input.officeAddress.trim().length > 0) {
    const normalized = input.officeAddress.trim();
    verificationUpdates.office_address = normalized;
    userUpdates.office_address = normalized;
  }
  if (typeof input.dateOfBirth === "string" && input.dateOfBirth.trim().length > 0) {
    const normalized = input.dateOfBirth.trim();
    verificationUpdates.date_of_birth = normalized;
    userUpdates.date_of_birth = normalized;
  }

  if (Object.keys(verificationUpdates).length > 0) {
    const { error } = await client
      .from(VERIFICATIONS_TABLE)
      .update(verificationUpdates)
      .eq("id", input.verificationId)
      .eq("user_id", input.userId);

    if (error && !isMissingTableOrColumnError(error)) {
      throw new Error(`Failed to save verification address details: ${error.message}`);
    }
  }

  if (Object.keys(userUpdates).length > 0) {
    const { error } = await client.from(USERS_TABLE).update(userUpdates).eq("id", input.userId);

    if (error && !isMissingTableOrColumnError(error)) {
      throw new Error(`Failed to sync user profile verification details: ${error.message}`);
    }
  }
}

function resolveMimeType(
  providedMimeType: string | undefined,
  payloadMimeType: string | undefined,
  fileName: string,
): string {
  const explicit = String(providedMimeType ?? "").trim().toLowerCase();
  if (explicit) return explicit;

  const payload = String(payloadMimeType ?? "").trim().toLowerCase();
  if (payload) return payload;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

export async function uploadVerificationDocument(
  input: UploadVerificationDocumentInput,
): Promise<UploadVerificationDocumentResult> {
  const userId = String(input.userId ?? "").trim();
  const documentType = normalizeDocumentType(input.documentType);
  const fileName = String(input.fileName ?? "").trim();
  const providedSize =
    typeof input.fileSizeBytes === "number" && Number.isFinite(input.fileSizeBytes)
      ? Math.max(0, Math.trunc(input.fileSizeBytes))
      : undefined;
  const homeAddress = normalizeAddress(input.homeAddress);
  const officeAddress = normalizeAddress(input.officeAddress);
  const dateOfBirth = normalizeDateOfBirth(input.dateOfBirth);

  if (!userId) {
    throw new Error("userId is required.");
  }
  if (!fileName) {
    throw new Error("fileName is required.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service credentials are required for verification document upload.");
  }

  const payload = parseBase64Payload(input.contentBase64);
  const buffer = payload.buffer;
  const resolvedSize = providedSize ?? buffer.length;
  if (resolvedSize <= 0) {
    throw new Error("Uploaded file is empty.");
  }
  if (resolvedSize > VERIFICATION_DOCUMENT_MAX_SIZE_BYTES) {
    throw new Error(
      `Verification document is too large. Max size is ${Math.floor(
        VERIFICATION_DOCUMENT_MAX_SIZE_BYTES / (1024 * 1024),
      )}MB.`,
    );
  }

  const mimeType = resolveMimeType(input.mimeType, payload.mimeType, fileName);
  if (!ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES.has(mimeType)) {
    throw new VerificationDocumentValidationError("Unsupported file type. Allowed types: PDF, JPG, PNG, WEBP.");
  }

  let addressMatch: UtilityBillAddressEvaluationResult | undefined;
  if (documentType === "utility_bill") {
    if (!homeAddress) {
      throw new VerificationDocumentValidationError(
        "Home address is required before uploading utility bill.",
      );
    }

    addressMatch = await evaluateUtilityBillAddress({
      buffer,
      mimeType,
      fileName,
      declaredHomeAddress: homeAddress,
    });

    if (isUtilityBillAddressMatchEnforced()) {
      if (addressMatch.status === "unreadable") {
        throw new VerificationDocumentValidationError(
          "Could not read an address from the utility bill. Upload a clearer utility bill where the address is visible.",
          { addressMatch },
        );
      }

      if (addressMatch.status === "mismatch") {
        throw new VerificationDocumentValidationError(
          "Utility bill address does not match the home address you entered. Use a utility bill that matches your current home address.",
          { addressMatch },
        );
      }
    }
  }

  const verificationId = await ensureVerificationRecord(client, userId, input.verificationId);
  await persistVerificationAddressDetails(client, {
    verificationId,
    userId,
    homeAddress,
    officeAddress,
    dateOfBirth,
  });
  const storagePath = `${userId}/${verificationId}/${Date.now()}_${sanitizeStorageFileName(fileName)}`;

  const { error: uploadError } = await client.storage
    .from(VERIFICATION_DOCUMENTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Verification document upload failed: ${uploadError.message}`);
  }

  let previewUrl: string | undefined;
  const { data: signedData, error: signedError } = await client.storage
    .from(VERIFICATION_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, VERIFICATION_DOCUMENT_SIGNED_URL_TTL_SEC);

  if (!signedError && signedData?.signedUrl) {
    previewUrl = String(signedData.signedUrl);
  }

  const documentUrl = storagePath;
  const fullInsertPayload = {
    verification_id: verificationId,
    document_type: documentType,
    document_url: documentUrl,
    bucket_id: VERIFICATION_DOCUMENTS_BUCKET,
    storage_path: storagePath,
    uploaded_by: isUuid(userId) ? userId : null,
    mime_type: mimeType,
    file_size_bytes: resolvedSize,
    extracted_address:
      addressMatch && addressMatch.extractedAddress ? addressMatch.extractedAddress : null,
    input_home_address:
      addressMatch && addressMatch.declaredAddress ? addressMatch.declaredAddress : null,
    address_match_status: addressMatch?.status ?? null,
    address_match_score:
      typeof addressMatch?.score === "number" && Number.isFinite(addressMatch.score)
        ? addressMatch.score
        : null,
    address_match_method: addressMatch?.method ?? null,
  };

  const { data: insertedFull, error: insertFullError } = await client
    .from(VERIFICATION_DOCUMENTS_TABLE)
    .insert(fullInsertPayload)
    .select("id")
    .maybeSingle<{ id: string }>();

  let documentId = String(insertedFull?.id ?? "");
  if (insertFullError) {
    if (!isMissingTableOrColumnError(insertFullError)) {
      throw new Error(`Failed to save verification document record: ${insertFullError.message}`);
    }

    const { data: insertedLegacy, error: insertLegacyError } = await client
      .from(VERIFICATION_DOCUMENTS_TABLE)
      .insert({
        verification_id: verificationId,
        document_type: documentType,
        document_url: documentUrl,
      })
      .select("id")
      .single<{ id: string }>();

    if (insertLegacyError || !insertedLegacy?.id) {
      throw new Error(
        `Failed to save verification document record: ${
          insertLegacyError?.message ?? "No data returned"
        }`,
      );
    }
    documentId = String(insertedLegacy.id);
  }

  return {
    verificationId,
    documentId,
    bucketId: VERIFICATION_DOCUMENTS_BUCKET,
    storagePath,
    previewUrl,
    addressMatch,
  };
}
