import { createHash } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SendState = {
  lastSentAtMs: number;
  windowStartMs: number;
  sendsInWindow: number;
};

type VerifyState = {
  failedAttempts: number;
  blockedUntilMs: number;
};

type GuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: "cooldown" | "send_rate_limited" | "verify_blocked";
      retryAfterSec: number;
    };

type OtpGuardRow = {
  phone_key: string;
  phone_last4?: string | null;
  last_sent_at?: string | null;
  send_window_started_at?: string | null;
  sends_in_window?: number | null;
  failed_verify_attempts?: number | null;
  verify_blocked_until?: string | null;
};

const GUARD_TABLE = process.env.SUPABASE_PHONE_OTP_GUARD_TABLE || "phone_otp_guards";
const sendStateByPhone = new Map<string, SendState>();
const verifyStateByPhone = new Map<string, VerifyState>();

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const SEND_COOLDOWN_SEC = toPositiveInt(process.env.PHONE_OTP_SEND_COOLDOWN_SEC, 60);
const SEND_MAX_PER_WINDOW = toPositiveInt(process.env.PHONE_OTP_MAX_SENDS_PER_WINDOW, 5);
const SEND_WINDOW_SEC = toPositiveInt(process.env.PHONE_OTP_SEND_WINDOW_SEC, 3600);
const VERIFY_MAX_FAILED_ATTEMPTS = toPositiveInt(process.env.PHONE_OTP_MAX_VERIFY_ATTEMPTS, 5);
const VERIFY_BLOCK_SEC = toPositiveInt(process.env.PHONE_OTP_VERIFY_BLOCK_SEC, 900);

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

function isDuplicateError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? "").trim();
  if (code === "23505") return true;
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return message.includes("duplicate key");
}

function nowMs(): number {
  return Date.now();
}

function toSec(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizePhone(phone: string): string {
  return String(phone ?? "").replace(/\s+/g, "").trim();
}

function getPhoneKey(phone: string): string {
  const normalized = normalizePhone(phone);
  const salt = String(process.env.PHONE_OTP_GUARD_SALT ?? "").trim();
  return createHash("sha256").update(`${salt}|${normalized}`).digest("hex");
}

function getPhoneLast4(phone: string): string {
  const digits = String(phone ?? "").replace(/\D+/g, "");
  return digits.slice(-4);
}

function cleanupFallbackStates(): void {
  const now = nowMs();
  const sendWindowMs = SEND_WINDOW_SEC * 1000;
  const verifyExpiryMs = VERIFY_BLOCK_SEC * 2000;

  sendStateByPhone.forEach((state, phone) => {
    if (now - state.windowStartMs > sendWindowMs * 2) {
      sendStateByPhone.delete(phone);
    }
  });

  verifyStateByPhone.forEach((state, phone) => {
    if (state.blockedUntilMs > 0) {
      if (now > state.blockedUntilMs + verifyExpiryMs) {
        verifyStateByPhone.delete(phone);
      }
      return;
    }

    if (state.failedAttempts <= 0) {
      verifyStateByPhone.delete(phone);
    }
  });
}

function checkPhoneSendAllowedFallback(phone: string): GuardResult {
  cleanupFallbackStates();
  const current = sendStateByPhone.get(phone);
  if (!current) return { ok: true };

  const now = nowMs();
  const sendCooldownMs = SEND_COOLDOWN_SEC * 1000;
  const sendWindowMs = SEND_WINDOW_SEC * 1000;

  if (now - current.lastSentAtMs < sendCooldownMs) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSec: toSec(sendCooldownMs - (now - current.lastSentAtMs)),
    };
  }

  if (now - current.windowStartMs >= sendWindowMs) {
    return { ok: true };
  }

  if (current.sendsInWindow >= SEND_MAX_PER_WINDOW) {
    return {
      ok: false,
      reason: "send_rate_limited",
      retryAfterSec: toSec(sendWindowMs - (now - current.windowStartMs)),
    };
  }

  return { ok: true };
}

function markPhoneCodeSentFallback(phone: string): void {
  cleanupFallbackStates();

  const now = nowMs();
  const sendWindowMs = SEND_WINDOW_SEC * 1000;
  const existing = sendStateByPhone.get(phone);

  if (!existing) {
    sendStateByPhone.set(phone, {
      lastSentAtMs: now,
      windowStartMs: now,
      sendsInWindow: 1,
    });
    return;
  }

  const inSameWindow = now - existing.windowStartMs < sendWindowMs;
  sendStateByPhone.set(phone, {
    lastSentAtMs: now,
    windowStartMs: inSameWindow ? existing.windowStartMs : now,
    sendsInWindow: inSameWindow ? existing.sendsInWindow + 1 : 1,
  });
}

function checkPhoneVerifyAllowedFallback(phone: string): GuardResult {
  cleanupFallbackStates();
  const state = verifyStateByPhone.get(phone);
  if (!state || state.blockedUntilMs <= 0) return { ok: true };

  const now = nowMs();
  if (now < state.blockedUntilMs) {
    return {
      ok: false,
      reason: "verify_blocked",
      retryAfterSec: toSec(state.blockedUntilMs - now),
    };
  }

  verifyStateByPhone.set(phone, { failedAttempts: 0, blockedUntilMs: 0 });
  return { ok: true };
}

function markPhoneVerifyFailedFallback(phone: string): {
  blocked: boolean;
  retryAfterSec: number;
  attemptsRemaining: number;
} {
  cleanupFallbackStates();
  const existing = verifyStateByPhone.get(phone) ?? { failedAttempts: 0, blockedUntilMs: 0 };
  const nextFailedAttempts = existing.failedAttempts + 1;
  const attemptsRemaining = Math.max(0, VERIFY_MAX_FAILED_ATTEMPTS - nextFailedAttempts);

  if (nextFailedAttempts >= VERIFY_MAX_FAILED_ATTEMPTS) {
    const blockedUntilMs = nowMs() + VERIFY_BLOCK_SEC * 1000;
    verifyStateByPhone.set(phone, {
      failedAttempts: 0,
      blockedUntilMs,
    });
    return {
      blocked: true,
      retryAfterSec: VERIFY_BLOCK_SEC,
      attemptsRemaining: 0,
    };
  }

  verifyStateByPhone.set(phone, {
    failedAttempts: nextFailedAttempts,
    blockedUntilMs: 0,
  });
  return {
    blocked: false,
    retryAfterSec: 0,
    attemptsRemaining,
  };
}

function markPhoneVerifySucceededFallback(phone: string): void {
  verifyStateByPhone.delete(phone);
}

async function ensureGuardRow(
  client: SupabaseClient,
  phoneKey: string,
  phoneLast4: string,
): Promise<OtpGuardRow | null> {
  const { data: existing, error: existingError } = await client
    .from(GUARD_TABLE)
    .select(
      "phone_key, phone_last4, last_sent_at, send_window_started_at, sends_in_window, failed_verify_attempts, verify_blocked_until",
    )
    .eq("phone_key", phoneKey)
    .maybeSingle<OtpGuardRow>();

  if (existingError) {
    if (isMissingTableOrColumnError(existingError)) return null;
    throw new Error(`OTP guard lookup failed: ${existingError.message}`);
  }
  if (existing) return existing;

  const { error: insertError } = await client.from(GUARD_TABLE).insert({
    phone_key: phoneKey,
    phone_last4: phoneLast4 || null,
    sends_in_window: 0,
    failed_verify_attempts: 0,
  });
  if (insertError && !isDuplicateError(insertError)) {
    if (isMissingTableOrColumnError(insertError)) return null;
    throw new Error(`OTP guard create failed: ${insertError.message}`);
  }

  const { data: created, error: createdError } = await client
    .from(GUARD_TABLE)
    .select(
      "phone_key, phone_last4, last_sent_at, send_window_started_at, sends_in_window, failed_verify_attempts, verify_blocked_until",
    )
    .eq("phone_key", phoneKey)
    .maybeSingle<OtpGuardRow>();

  if (createdError) {
    if (isMissingTableOrColumnError(createdError)) return null;
    throw new Error(`OTP guard reload failed: ${createdError.message}`);
  }

  return created ?? null;
}

async function updateGuardRow(
  client: SupabaseClient,
  phoneKey: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await client.from(GUARD_TABLE).update(payload).eq("phone_key", phoneKey);
  if (!error) return true;
  if (isMissingTableOrColumnError(error)) return false;
  throw new Error(`OTP guard update failed: ${error.message}`);
}

export async function checkPhoneSendAllowed(phone: string): Promise<GuardResult> {
  const normalizedPhone = normalizePhone(phone);
  const client = getClient();
  if (!client) return checkPhoneSendAllowedFallback(normalizedPhone);

  const phoneKey = getPhoneKey(normalizedPhone);
  const row = await ensureGuardRow(client, phoneKey, getPhoneLast4(normalizedPhone));
  if (!row) return checkPhoneSendAllowedFallback(normalizedPhone);

  const now = nowMs();
  const sendCooldownMs = SEND_COOLDOWN_SEC * 1000;
  const sendWindowMs = SEND_WINDOW_SEC * 1000;
  const lastSentAtMs = parseTimestampMs(row.last_sent_at) ?? 0;
  const windowStartMs = parseTimestampMs(row.send_window_started_at) ?? 0;
  const sendsInWindow = Math.max(0, Number(row.sends_in_window ?? 0));

  if (lastSentAtMs > 0 && now - lastSentAtMs < sendCooldownMs) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSec: toSec(sendCooldownMs - (now - lastSentAtMs)),
    };
  }

  if (windowStartMs > 0 && now - windowStartMs < sendWindowMs && sendsInWindow >= SEND_MAX_PER_WINDOW) {
    return {
      ok: false,
      reason: "send_rate_limited",
      retryAfterSec: toSec(sendWindowMs - (now - windowStartMs)),
    };
  }

  return { ok: true };
}

export async function markPhoneCodeSent(phone: string): Promise<void> {
  const normalizedPhone = normalizePhone(phone);
  const client = getClient();
  if (!client) {
    markPhoneCodeSentFallback(normalizedPhone);
    return;
  }

  const phoneKey = getPhoneKey(normalizedPhone);
  const row = await ensureGuardRow(client, phoneKey, getPhoneLast4(normalizedPhone));
  if (!row) {
    markPhoneCodeSentFallback(normalizedPhone);
    return;
  }

  const now = nowMs();
  const nowIso = new Date(now).toISOString();
  const sendWindowMs = SEND_WINDOW_SEC * 1000;
  const windowStartMs = parseTimestampMs(row.send_window_started_at) ?? 0;
  const sendsInWindow = Math.max(0, Number(row.sends_in_window ?? 0));
  const inSameWindow = windowStartMs > 0 && now - windowStartMs < sendWindowMs;

  const updated = await updateGuardRow(client, phoneKey, {
    phone_last4: getPhoneLast4(normalizedPhone) || null,
    last_sent_at: nowIso,
    send_window_started_at: inSameWindow ? new Date(windowStartMs).toISOString() : nowIso,
    sends_in_window: inSameWindow ? sendsInWindow + 1 : 1,
  });

  if (!updated) {
    markPhoneCodeSentFallback(normalizedPhone);
  }
}

export async function checkPhoneVerifyAllowed(phone: string): Promise<GuardResult> {
  const normalizedPhone = normalizePhone(phone);
  const client = getClient();
  if (!client) return checkPhoneVerifyAllowedFallback(normalizedPhone);

  const phoneKey = getPhoneKey(normalizedPhone);
  const row = await ensureGuardRow(client, phoneKey, getPhoneLast4(normalizedPhone));
  if (!row) return checkPhoneVerifyAllowedFallback(normalizedPhone);

  const now = nowMs();
  const blockedUntilMs = parseTimestampMs(row.verify_blocked_until);
  if (blockedUntilMs && now < blockedUntilMs) {
    return {
      ok: false,
      reason: "verify_blocked",
      retryAfterSec: toSec(blockedUntilMs - now),
    };
  }

  if (blockedUntilMs && now >= blockedUntilMs) {
    const updated = await updateGuardRow(client, phoneKey, {
      failed_verify_attempts: 0,
      verify_blocked_until: null,
    });
    if (!updated) {
      return checkPhoneVerifyAllowedFallback(normalizedPhone);
    }
  }

  return { ok: true };
}

export async function markPhoneVerifyFailed(phone: string): Promise<{
  blocked: boolean;
  retryAfterSec: number;
  attemptsRemaining: number;
}> {
  const normalizedPhone = normalizePhone(phone);
  const client = getClient();
  if (!client) return markPhoneVerifyFailedFallback(normalizedPhone);

  const phoneKey = getPhoneKey(normalizedPhone);
  const row = await ensureGuardRow(client, phoneKey, getPhoneLast4(normalizedPhone));
  if (!row) return markPhoneVerifyFailedFallback(normalizedPhone);

  const now = nowMs();
  const blockedUntilMs = parseTimestampMs(row.verify_blocked_until);
  if (blockedUntilMs && now < blockedUntilMs) {
    return {
      blocked: true,
      retryAfterSec: toSec(blockedUntilMs - now),
      attemptsRemaining: 0,
    };
  }

  const currentFailed =
    blockedUntilMs && now >= blockedUntilMs
      ? 0
      : Math.max(0, Number(row.failed_verify_attempts ?? 0));

  const nextFailedAttempts = currentFailed + 1;
  const attemptsRemaining = Math.max(0, VERIFY_MAX_FAILED_ATTEMPTS - nextFailedAttempts);

  if (nextFailedAttempts >= VERIFY_MAX_FAILED_ATTEMPTS) {
    const blockedUntilIso = new Date(now + VERIFY_BLOCK_SEC * 1000).toISOString();
    const updated = await updateGuardRow(client, phoneKey, {
      failed_verify_attempts: 0,
      verify_blocked_until: blockedUntilIso,
    });
    if (!updated) return markPhoneVerifyFailedFallback(normalizedPhone);

    return {
      blocked: true,
      retryAfterSec: VERIFY_BLOCK_SEC,
      attemptsRemaining: 0,
    };
  }

  const updated = await updateGuardRow(client, phoneKey, {
    failed_verify_attempts: nextFailedAttempts,
    verify_blocked_until: null,
  });
  if (!updated) return markPhoneVerifyFailedFallback(normalizedPhone);

  return {
    blocked: false,
    retryAfterSec: 0,
    attemptsRemaining,
  };
}

export async function markPhoneVerifySucceeded(phone: string): Promise<void> {
  const normalizedPhone = normalizePhone(phone);
  const client = getClient();
  if (!client) {
    markPhoneVerifySucceededFallback(normalizedPhone);
    return;
  }

  const phoneKey = getPhoneKey(normalizedPhone);
  const updated = await updateGuardRow(client, phoneKey, {
    failed_verify_attempts: 0,
    verify_blocked_until: null,
  });
  if (!updated) {
    markPhoneVerifySucceededFallback(normalizedPhone);
  }
}

export function getPhoneOtpPolicy(): {
  sendCooldownSec: number;
  maxSendsPerWindow: number;
  sendWindowSec: number;
  maxVerifyAttempts: number;
  verifyBlockSec: number;
} {
  return {
    sendCooldownSec: SEND_COOLDOWN_SEC,
    maxSendsPerWindow: SEND_MAX_PER_WINDOW,
    sendWindowSec: SEND_WINDOW_SEC,
    maxVerifyAttempts: VERIFY_MAX_FAILED_ATTEMPTS,
    verifyBlockSec: VERIFY_BLOCK_SEC,
  };
}
