import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TABLE = process.env.SUPABASE_VERIFICATIONS_TABLE || "verifications";
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";

type VerificationRecord = {
  user_id: string;
  mode: "kyc" | "biometric";
  provider: "smile-id" | "mock";
  status: "approved" | "pending" | "failed";
  job_id: string;
  smile_job_id?: string | null;
  message?: string | null;
};

type VerificationStatus = "approved" | "pending" | "failed";
type VerificationProvider = "smile-id" | "mock";

type UpdatedVerificationRecord = {
  userId: string;
  status: VerificationStatus;
  previousStatus: VerificationStatus;
  changed: boolean;
};

type VerificationLookupInput = {
  jobId?: string | null;
  smileJobId?: string | null;
  userId?: string | null;
};

type VerificationLookupRecord = {
  id: string;
  user_id: string;
  status: VerificationStatus;
  message?: string | null;
};

type UserVerificationSnapshot = {
  userId: string;
  isVerified: boolean;
  userRowFound: boolean;
  latestStatus: VerificationStatus | null;
  latestJobId: string | null;
  latestSmileJobId: string | null;
  latestProvider: VerificationProvider | null;
  latestMessage: string | null;
  latestUpdatedAt: string | null;
};

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function isInvalidUuidError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("invalid input syntax for type uuid") ||
    message.includes("invalid input syntax") && message.includes("uuid")
  );
}

export async function saveVerification(record: VerificationRecord): Promise<void> {
  const client = getClient();
  if (!client) return;

  const { error } = await client.from(TABLE).insert(record);
  if (error) {
    throw new Error(`Supabase saveVerification failed: ${error.message}`);
  }
}

async function findVerificationByField(
  client: SupabaseClient,
  field: "job_id" | "smile_job_id",
  value: string,
): Promise<VerificationLookupRecord | null> {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;

  const { data, error } = await client
    .from(TABLE)
    .select("id, user_id, status, message")
    .eq(field, normalized)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<VerificationLookupRecord>();

  if (error) {
    throw new Error(`Supabase lookup by ${field} failed: ${error.message}`);
  }
  return data ?? null;
}

async function findLatestVerificationForUser(
  client: SupabaseClient,
  userId: string,
): Promise<VerificationLookupRecord | null> {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return null;

  const primary = await client
    .from(TABLE)
    .select("id, user_id, status, message")
    .eq("user_id", normalizedUserId)
    .eq("provider", "smile-id")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<VerificationLookupRecord>();

  if (primary.error && !isMissingTableOrColumnError(primary.error)) {
    throw new Error(`Supabase lookup by user+provider failed: ${primary.error.message}`);
  }
  if (primary.data) return primary.data;

  const fallback = await client
    .from(TABLE)
    .select("id, user_id, status, message")
    .eq("user_id", normalizedUserId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<VerificationLookupRecord>();

  if (fallback.error) {
    throw new Error(`Supabase fallback lookup by user failed: ${fallback.error.message}`);
  }
  return fallback.data ?? null;
}

async function applyVerificationUpdate(
  client: SupabaseClient,
  existing: VerificationLookupRecord,
  status: VerificationStatus,
  message?: string,
): Promise<UpdatedVerificationRecord> {
  // Idempotency + monotonic status semantics:
  // once approved, do not downgrade from subsequent callbacks.
  const nextStatus = existing.status === "approved" ? "approved" : status;
  const normalizedMessage =
    typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
  const messageChanged =
    normalizedMessage !== null && normalizedMessage !== String(existing.message ?? "");
  const statusChanged = nextStatus !== existing.status;

  if (!statusChanged && !messageChanged) {
    return {
      userId: String(existing.user_id ?? ""),
      status: existing.status,
      previousStatus: existing.status,
      changed: false,
    };
  }

  const updatePayload: { status: VerificationStatus; message?: string | null } = {
    status: nextStatus,
  };
  if (messageChanged) {
    updatePayload.message = normalizedMessage;
  }

  const { data, error } = await client
    .from(TABLE)
    .update(updatePayload)
    .eq("id", existing.id)
    .select("user_id, status")
    .maybeSingle<{ user_id: string; status: VerificationStatus }>();

  if (error) {
    throw new Error(`Supabase verification update failed: ${error.message}`);
  }

  if (!data) {
    return {
      userId: String(existing.user_id ?? ""),
      status: nextStatus,
      previousStatus: existing.status,
      changed: true,
    };
  }

  return {
    userId: String(data.user_id ?? ""),
    status: data.status,
    previousStatus: existing.status,
    changed: true,
  };
}

export async function updateVerificationByJobId(
  jobId: string,
  status: VerificationStatus,
  message?: string,
): Promise<UpdatedVerificationRecord | null> {
  const client = getClient();
  if (!client) return null;

  const normalizedJobId = String(jobId ?? "").trim();
  if (!normalizedJobId) return null;

  const existing =
    (await findVerificationByField(client, "job_id", normalizedJobId)) ??
    (await findVerificationByField(client, "smile_job_id", normalizedJobId));

  if (!existing) return null;
  return applyVerificationUpdate(client, existing, status, message);
}

export async function updateVerificationByCallbackIdentifiers(
  input: VerificationLookupInput,
  status: VerificationStatus,
  message?: string,
): Promise<UpdatedVerificationRecord | null> {
  const client = getClient();
  if (!client) return null;

  const normalizedJobId = String(input.jobId ?? "").trim();
  const normalizedSmileJobId = String(input.smileJobId ?? "").trim();
  const normalizedUserId = String(input.userId ?? "").trim();

  const lookupOrder: Array<{ field: "job_id" | "smile_job_id"; value: string }> = [];
  if (normalizedJobId) lookupOrder.push({ field: "job_id", value: normalizedJobId });
  if (normalizedSmileJobId) lookupOrder.push({ field: "smile_job_id", value: normalizedSmileJobId });
  if (normalizedJobId) lookupOrder.push({ field: "smile_job_id", value: normalizedJobId });
  if (normalizedSmileJobId) lookupOrder.push({ field: "job_id", value: normalizedSmileJobId });

  const seen = new Set<string>();
  for (const lookup of lookupOrder) {
    const key = `${lookup.field}:${lookup.value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const existing = await findVerificationByField(client, lookup.field, lookup.value);
    if (!existing) continue;
    return applyVerificationUpdate(client, existing, status, message);
  }

  if (!normalizedUserId) return null;
  const fallbackExisting = await findLatestVerificationForUser(client, normalizedUserId);
  if (!fallbackExisting) return null;
  return applyVerificationUpdate(client, fallbackExisting, status, message);
}

export async function setUserVerificationState(
  userId: string,
  isVerified: boolean,
): Promise<void> {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return;

  const client = getClient();
  if (!client) return;

  const { error } = await client
    .from(USERS_TABLE)
    .update({ is_verified: isVerified })
    .eq("id", normalizedUserId);

  if (!error) return;
  if (isMissingTableOrColumnError(error)) return;
  if (isInvalidUuidError(error)) return;

  throw new Error(`Supabase setUserVerificationState failed: ${error.message}`);
}

export async function getUserVerificationSnapshot(
  userId: string,
): Promise<UserVerificationSnapshot | null> {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return null;

  const client = getClient();
  if (!client) return null;

  let userIsVerified = false;
  let userRowFound = false;

  const { data: userRow, error: userError } = await client
    .from(USERS_TABLE)
    .select("is_verified")
    .eq("id", normalizedUserId)
    .maybeSingle<{ is_verified?: boolean | null }>();

  if (userError && !isMissingTableOrColumnError(userError)) {
    if (isInvalidUuidError(userError)) {
      // Mock/dev user IDs may be non-UUID strings while the DB column is UUID.
      // Treat as "user row not found" so verification polling still works.
      userRowFound = false;
      userIsVerified = false;
    } else {
      throw new Error(`Supabase getUserVerificationSnapshot user lookup failed: ${userError.message}`);
    }
  }

  if (!userError && userRow && typeof userRow === "object") {
    userRowFound = true;
    userIsVerified = Boolean(userRow.is_verified);
  } else if (userError && isInvalidUuidError(userError)) {
    // Keep graceful fallback when id format is incompatible.
    userRowFound = false;
    userIsVerified = false;
  }

  const { data: latest, error: latestError } = await client
    .from(TABLE)
    .select("status, job_id, smile_job_id, provider, message, updated_at, created_at")
    .eq("user_id", normalizedUserId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      status: VerificationStatus;
      job_id: string;
      smile_job_id?: string | null;
      provider?: VerificationProvider | null;
      message?: string | null;
      updated_at?: string | null;
      created_at?: string | null;
    }>();

  if (latestError && !isMissingTableOrColumnError(latestError)) {
    throw new Error(
      `Supabase getUserVerificationSnapshot verification lookup failed: ${latestError.message}`,
    );
  }

  const { data: approvedRecord, error: approvedError } = await client
    .from(TABLE)
    .select("status")
    .eq("user_id", normalizedUserId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle<{ status: VerificationStatus }>();

  if (approvedError && !isMissingTableOrColumnError(approvedError)) {
    throw new Error(
      `Supabase getUserVerificationSnapshot approved lookup failed: ${approvedError.message}`,
    );
  }

  return {
    userId: normalizedUserId,
    isVerified: userIsVerified || Boolean(approvedRecord) || latest?.status === "approved",
    userRowFound,
    latestStatus: latest?.status ?? null,
    latestJobId: latest?.job_id ?? null,
    latestSmileJobId: latest?.smile_job_id ?? null,
    latestProvider: latest?.provider ?? null,
    latestMessage: latest?.message ?? null,
    latestUpdatedAt: latest?.updated_at ?? latest?.created_at ?? null,
  };
}
