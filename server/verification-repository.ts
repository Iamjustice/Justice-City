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

type UpdatedVerificationRecord = {
  userId: string;
  status: VerificationStatus;
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

export async function saveVerification(record: VerificationRecord): Promise<void> {
  const client = getClient();
  if (!client) return;

  const { error } = await client.from(TABLE).insert(record);
  if (error) {
    throw new Error(`Supabase saveVerification failed: ${error.message}`);
  }
}

export async function updateVerificationByJobId(
  jobId: string,
  status: VerificationStatus,
  message?: string,
): Promise<UpdatedVerificationRecord | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .update({ status, message: message ?? null })
    .eq("job_id", jobId)
    .select("user_id, status")
    .maybeSingle<{ user_id: string; status: VerificationStatus }>();

  if (error) {
    throw new Error(`Supabase updateVerificationByJobId failed: ${error.message}`);
  }

  if (!data) return null;

  return {
    userId: String(data.user_id ?? ""),
    status,
  };
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

  throw new Error(`Supabase setUserVerificationState failed: ${error.message}`);
}
