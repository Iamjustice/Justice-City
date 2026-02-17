type TwilioVerifyStatus = "pending" | "approved" | "canceled" | "max_attempts_reached" | "failed";

type TwilioSendCodeResult = {
  sid: string;
  to: string;
  channel: string;
  status: TwilioVerifyStatus;
  valid: boolean;
};

type TwilioCheckCodeResult = {
  sid: string;
  to: string;
  status: TwilioVerifyStatus;
  valid: boolean;
};

type TwilioVerifyConfig = {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  baseUrl: string;
};

function readEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  return value;
}

function isProduction(): boolean {
  return String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function resolveTwilioEnv(suffix: string): string {
  const environmentSpecificKey = isProduction()
    ? `TWILIO_LIVE_${suffix}`
    : `TWILIO_TEST_${suffix}`;
  const genericKey = `TWILIO_${suffix}`;

  return readEnv(environmentSpecificKey) || readEnv(genericKey);
}

function requiredTwilioEnv(suffix: string): string {
  const value = resolveTwilioEnv(suffix);
  if (!value) {
    const expectedEnvKey = isProduction() ? `TWILIO_LIVE_${suffix}` : `TWILIO_TEST_${suffix}`;
    const fallbackEnvKey = `TWILIO_${suffix}`;
    throw new Error(
      `${expectedEnvKey} is missing (or set ${fallbackEnvKey} as fallback). Configure Twilio credentials in your server environment.`,
    );
  }
  return value;
}

function normalizeBaseUrl(rawUrl: string): string {
  return String(rawUrl ?? "").trim().replace(/\/+$/, "");
}

function getTwilioVerifyConfig(): TwilioVerifyConfig {
  const accountSid = requiredTwilioEnv("ACCOUNT_SID");
  const authToken = requiredTwilioEnv("AUTH_TOKEN");
  const serviceSid = requiredTwilioEnv("VERIFY_SERVICE_SID");
  const baseUrl =
    resolveTwilioEnv("VERIFY_BASE_URL") || "https://verify.twilio.com/v2";

  return {
    accountSid,
    authToken,
    serviceSid,
    baseUrl: normalizeBaseUrl(baseUrl),
  };
}

async function parseTwilioError(response: Response): Promise<string> {
  const fallback = `Twilio Verify request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as { message?: string; detail?: string };
    return String(body.message ?? body.detail ?? fallback);
  } catch {
    return fallback;
  }
}

function buildAuthHeader(accountSid: string, authToken: string): string {
  const encoded = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function sendPhoneVerificationCode(phone: string): Promise<TwilioSendCodeResult> {
  const config = getTwilioVerifyConfig();

  const response = await fetch(`${config.baseUrl}/Services/${config.serviceSid}/Verifications`, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(config.accountSid, config.authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: phone,
      Channel: "sms",
    }),
  });

  if (!response.ok) {
    throw new Error(await parseTwilioError(response));
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    sid: String(data.sid ?? ""),
    to: String(data.to ?? phone),
    channel: String(data.channel ?? "sms"),
    status: String(data.status ?? "pending") as TwilioVerifyStatus,
    valid: Boolean(data.valid),
  };
}

export async function checkPhoneVerificationCode(
  phone: string,
  code: string,
): Promise<TwilioCheckCodeResult> {
  const config = getTwilioVerifyConfig();

  const response = await fetch(`${config.baseUrl}/Services/${config.serviceSid}/VerificationCheck`, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(config.accountSid, config.authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: phone,
      Code: code,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseTwilioError(response));
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    sid: String(data.sid ?? ""),
    to: String(data.to ?? phone),
    status: String(data.status ?? "pending") as TwilioVerifyStatus,
    valid: Boolean(data.valid),
  };
}
