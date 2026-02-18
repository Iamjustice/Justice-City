import { createHash, randomInt } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const EMAIL_OTP_TABLE = process.env.SUPABASE_EMAIL_OTP_TABLE || "verification_email_otps";
const EMAIL_OTP_TTL_SEC = Number.parseInt(String(process.env.EMAIL_OTP_TTL_SEC ?? "600"), 10) || 600;

type EmailOtpRow = {
  email_key: string;
  code_hash?: string | null;
  expires_at?: string | null;
  used_at?: string | null;
};

type SendEmailOtpResult = {
  to: string;
  status: "pending";
  ttlSec: number;
  providerMessageId?: string;
  templateUsed?: boolean;
};

type CheckEmailOtpResult = {
  to: string;
  valid: boolean;
  status: "approved" | "invalid" | "expired";
};

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

function normalizeEmail(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function getEmailKey(email: string): string {
  const normalized = normalizeEmail(email);
  const salt =
    String(process.env.EMAIL_OTP_KEY_SALT ?? "").trim() ||
    String(process.env.PHONE_OTP_GUARD_SALT ?? "").trim();
  return createHash("sha256").update(`${salt}|${normalized}`).digest("hex");
}

function getCodeHash(emailKey: string, code: string): string {
  const salt =
    String(process.env.EMAIL_OTP_CODE_SALT ?? "").trim() ||
    String(process.env.PHONE_OTP_GUARD_SALT ?? "").trim();
  return createHash("sha256").update(`${salt}|${emailKey}|${String(code).trim()}`).digest("hex");
}

function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

function normalizeLegacyTemplatePlaceholders(templateHtml: string): string {
  return String(templateHtml ?? "")
    .replace(/\{\{\s*1\s*\}\}/g, "{{code}}")
    .replace(/\{\{\s*2\s*\}\}/g, "{{app_name}}")
    .replace(/\{\{\s*3\s*\}\}/g, "{{expires_in_minutes}}");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTemplateHtml(
  templateHtml: string,
  templateData: Record<string, string | number>,
): string {
  const normalized = normalizeLegacyTemplatePlaceholders(templateHtml);
  return normalized.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, rawKey: string) => {
    const key = String(rawKey ?? "").trim();
    if (!key) return "";
    return escapeHtml(templateData[key] ?? "");
  });
}

async function sendEmailViaSendGrid(
  to: string,
  code: string,
): Promise<{ messageId?: string; templateUsed: boolean }> {
  const apiKey = String(process.env.SENDGRID_API_KEY ?? "").trim();
  const fromEmail = String(process.env.SENDGRID_FROM_EMAIL ?? "").trim();
  const fromName = String(process.env.SENDGRID_FROM_NAME ?? "Justice City").trim();
  const templateId = String(process.env.SENDGRID_TEMPLATE_ID ?? "").trim();
  const templateCodeKey = String(process.env.SENDGRID_TEMPLATE_CODE_KEY ?? "code").trim() || "code";
  const templateExpiryKey =
    String(process.env.SENDGRID_TEMPLATE_EXPIRY_MIN_KEY ?? "expiryMinutes").trim() || "expiryMinutes";
  const templateBrandKey =
    String(process.env.SENDGRID_TEMPLATE_BRAND_KEY ?? "brandName").trim() || "brandName";
  const rawHtmlTemplate = String(process.env.SENDGRID_TEMPLATE_HTML ?? "").trim();
  const brandName = String(process.env.SENDGRID_BRAND_NAME ?? (fromName || "Justice City")).trim();
  const expiryMinutes = Math.max(1, Math.floor(EMAIL_OTP_TTL_SEC / 60));

  if (!apiKey || !fromEmail) {
    throw new Error("SENDGRID_API_KEY and SENDGRID_FROM_EMAIL are required for email OTP.");
  }

  const subject = "Justice City verification code";
  const textContent = `Your verification code is ${code}. It expires in ${expiryMinutes} minutes.`;
  const htmlContent = `<p>Your verification code is <strong>${code}</strong>.</p><p>This code expires in ${expiryMinutes} minutes.</p>`;

  const requestBody: Record<string, unknown> = {
    personalizations: [
      {
        to: [{ email: to }],
      },
    ],
    from: {
      email: fromEmail,
      name: fromName || undefined,
    },
  };

  const templateData: Record<string, string | number> = {
    [templateCodeKey]: code,
    [templateExpiryKey]: expiryMinutes,
    [templateBrandKey]: brandName,
    code,
    app_name: brandName,
    expires_in_minutes: expiryMinutes,
    expiryMinutes,
    brandName,
    twilio_code: code,
    ttl: String(expiryMinutes),
    twilio_service_name: brandName,
    "1": code,
    "2": brandName,
    "3": expiryMinutes,
  };

  if (templateId) {

    requestBody.template_id = templateId;
    requestBody.personalizations = [
      {
        to: [{ email: to }],
        dynamic_template_data: templateData,
      },
    ];
  } else if (rawHtmlTemplate) {
    requestBody.personalizations = [
      {
        to: [{ email: to }],
        subject,
      },
    ];
    requestBody.content = [
      { type: "text/plain", value: textContent },
      { type: "text/html", value: renderTemplateHtml(rawHtmlTemplate, templateData) },
    ];
  } else {
    requestBody.personalizations = [
      {
        to: [{ email: to }],
        subject,
      },
    ];
    requestBody.content = [
      { type: "text/plain", value: textContent },
      { type: "text/html", value: htmlContent },
    ];
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let message = `SendGrid request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { errors?: Array<{ message?: string }> };
      const first = payload?.errors?.[0]?.message;
      if (first && first.trim()) message = first;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const messageId = String(response.headers.get("x-message-id") ?? "").trim() || undefined;
  return {
    messageId,
    templateUsed: Boolean(templateId),
  };
}

async function upsertEmailOtp(
  client: SupabaseClient,
  emailKey: string,
  codeHash: string,
  expiresAtIso: string,
): Promise<void> {
  const { error } = await client.from(EMAIL_OTP_TABLE).upsert(
    {
      email_key: emailKey,
      code_hash: codeHash,
      expires_at: expiresAtIso,
      used_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email_key" },
  );

  if (error) {
    throw new Error(`Failed to persist email OTP: ${error.message}`);
  }
}

export async function sendEmailVerificationCode(email: string): Promise<SendEmailOtpResult> {
  const normalizedEmail = normalizeEmail(email);
  const emailKey = getEmailKey(normalizedEmail);
  const code = generateOtpCode();
  const codeHash = getCodeHash(emailKey, code);
  const expiresAtIso = new Date(Date.now() + EMAIL_OTP_TTL_SEC * 1000).toISOString();

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service credentials are required for email OTP persistence.");
  }

  try {
    await upsertEmailOtp(client, emailKey, codeHash, expiresAtIso);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      isMissingTableOrColumnError(error)
    ) {
      throw new Error(
        "Email OTP storage table is missing. Run supabase/verification_email_otp_storage.sql first.",
      );
    }
    throw error;
  }

  const provider = await sendEmailViaSendGrid(normalizedEmail, code);

  return {
    to: normalizedEmail,
    status: "pending",
    ttlSec: EMAIL_OTP_TTL_SEC,
    providerMessageId: provider.messageId,
    templateUsed: provider.templateUsed,
  };
}

export async function checkEmailVerificationCode(
  email: string,
  code: string,
): Promise<CheckEmailOtpResult> {
  const normalizedEmail = normalizeEmail(email);
  const client = getClient();
  if (!client) {
    throw new Error("Supabase service credentials are required for email OTP verification.");
  }

  const emailKey = getEmailKey(normalizedEmail);
  const { data, error } = await client
    .from(EMAIL_OTP_TABLE)
    .select("email_key, code_hash, expires_at, used_at")
    .eq("email_key", emailKey)
    .maybeSingle<EmailOtpRow>();

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      throw new Error(
        "Email OTP storage table is missing. Run supabase/verification_email_otp_storage.sql first.",
      );
    }
    throw new Error(`Failed to read email OTP: ${error.message}`);
  }

  if (!data || !data.code_hash) {
    return {
      to: normalizedEmail,
      valid: false,
      status: "invalid",
    };
  }

  const expiresAtMs = data.expires_at ? Date.parse(data.expires_at) : NaN;
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    return {
      to: normalizedEmail,
      valid: false,
      status: "expired",
    };
  }

  const expectedHash = getCodeHash(emailKey, code);
  if (expectedHash !== String(data.code_hash)) {
    return {
      to: normalizedEmail,
      valid: false,
      status: "invalid",
    };
  }

  const { error: updateError } = await client
    .from(EMAIL_OTP_TABLE)
    .update({
      used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("email_key", emailKey);

  if (updateError && !isMissingTableOrColumnError(updateError)) {
    throw new Error(`Failed to finalize email OTP usage: ${updateError.message}`);
  }

  return {
    to: normalizedEmail,
    valid: true,
    status: "approved",
  };
}
