type UtilityBillAddressMatchStatus = "matched" | "mismatch" | "unreadable" | "skipped";

type UtilityBillAddressEvaluationInput = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  declaredHomeAddress?: string;
};

type UtilityBillAddressEvaluationResult = {
  status: UtilityBillAddressMatchStatus;
  score: number;
  threshold: number;
  extractedAddress?: string;
  declaredAddress?: string;
  method?: "openai_vision" | "pdf_text" | "raw_text";
  reason?: string;
};

type OpenAiAddressExtraction = {
  address?: string;
  confidence?: number;
};

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseThresholdEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeAddressForMatch(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\bst\b\.?/g, "street")
    .replace(/\brd\b\.?/g, "road")
    .replace(/\bave\b\.?/g, "avenue")
    .replace(/\bapt\b\.?/g, "apartment")
    .replace(/\bln\b\.?/g, "lane")
    .replace(/\bdr\b\.?/g, "drive")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toAddressTokens(value: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "of",
    "nigeria",
    "state",
    "lga",
    "local",
    "government",
    "area",
  ]);
  return normalizeAddressForMatch(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function scoreAddressSimilarity(inputAddress: string, extractedAddress: string): number {
  const normalizedInput = normalizeAddressForMatch(inputAddress);
  const normalizedExtracted = normalizeAddressForMatch(extractedAddress);
  if (!normalizedInput || !normalizedExtracted) return 0;
  if (
    normalizedExtracted.includes(normalizedInput) ||
    normalizedInput.includes(normalizedExtracted)
  ) {
    return 1;
  }

  const inputTokens = new Set(toAddressTokens(normalizedInput));
  const extractedTokens = new Set(toAddressTokens(normalizedExtracted));
  if (inputTokens.size === 0 || extractedTokens.size === 0) return 0;

  let intersection = 0;
  inputTokens.forEach((token) => {
    if (extractedTokens.has(token)) {
      intersection += 1;
    }
  });

  const union = inputTokens.size + extractedTokens.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function extractPrintableText(buffer: Buffer): string {
  const latin1 = buffer.toString("latin1");

  const parenthesized = Array.from(latin1.matchAll(/\(([^()]*)\)/g))
    .map((match) => String(match[1] ?? ""))
    .join("\n");

  const cleaned = `${parenthesized}\n${latin1}`
    .replace(/\\[nr]/g, " ")
    .replace(/[^\x20-\x7E\r\n]+/g, " ")
    .replace(/[ \t]+/g, " ");

  return cleaned;
}

function extractAddressFromText(text: string): string | undefined {
  const normalizedText = String(text ?? "").replace(/\r/g, "\n");
  const lines = normalizedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 5 && line.length <= 220);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const labeledMatch = line.match(
      /(?:service|residential|home|customer|premises|supply|billing)?\s*address\s*[:\-]?\s*(.+)?/i,
    );
    if (!labeledMatch) continue;

    const inline = String(labeledMatch[1] ?? "").trim();
    if (inline.length >= 6) return inline;

    const nextLine = String(lines[index + 1] ?? "").trim();
    if (nextLine.length >= 6) return nextLine;
  }

  const addressLike = lines.find((line) =>
    /\d/.test(line) &&
    /(street|road|avenue|close|crescent|drive|lane|estate|phase|plot|house|flat|apartment)/i.test(
      line,
    ),
  );
  if (addressLike) return addressLike;

  return undefined;
}

async function extractAddressWithOpenAiVision(
  buffer: Buffer,
  mimeType: string,
): Promise<OpenAiAddressExtraction | null> {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  if (!mimeType.startsWith("image/")) return null;

  const model = String(process.env.UTILITY_BILL_OCR_OPENAI_MODEL ?? "gpt-4o-mini").trim();
  if (!model) return null;

  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract the service/residential address from this utility bill image. " +
                'Respond as JSON object with keys: "address" (string) and "confidence" (0-1 number). ' +
                'If no clear address is present, use address as empty string and confidence 0.',
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const completion = payload as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const rawContent = String(completion?.choices?.[0]?.message?.content ?? "").trim();
  if (!rawContent) return null;

  try {
    const parsed = JSON.parse(rawContent) as {
      address?: unknown;
      confidence?: unknown;
    };
    const address = String(parsed.address ?? "").trim();
    const confidence = Number(parsed.confidence);
    return {
      address: address || undefined,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : undefined,
    };
  } catch {
    return null;
  }
}

export function isUtilityBillAddressMatchEnforced(): boolean {
  return parseBooleanEnv(process.env.UTILITY_BILL_ADDRESS_MATCH_ENFORCED, true);
}

export async function evaluateUtilityBillAddress(
  input: UtilityBillAddressEvaluationInput,
): Promise<UtilityBillAddressEvaluationResult> {
  const threshold = parseThresholdEnv(process.env.UTILITY_BILL_ADDRESS_MATCH_THRESHOLD, 0.55);
  const declaredAddress = String(input.declaredHomeAddress ?? "").trim();
  if (!declaredAddress) {
    return {
      status: "skipped",
      score: 0,
      threshold,
      reason: "declared_address_missing",
    };
  }

  let extractedAddress = "";
  let method: UtilityBillAddressEvaluationResult["method"] | undefined;

  try {
    const openAiResult = await extractAddressWithOpenAiVision(input.buffer, input.mimeType);
    if (openAiResult?.address) {
      extractedAddress = openAiResult.address;
      method = "openai_vision";
    }
  } catch {
    // Ignore vision errors and fallback to text extraction.
  }

  if (!extractedAddress) {
    const printableText = extractPrintableText(input.buffer);
    const fromText = extractAddressFromText(printableText);
    if (fromText) {
      extractedAddress = fromText;
      method = input.mimeType.includes("pdf") ? "pdf_text" : "raw_text";
    }
  }

  if (!extractedAddress) {
    return {
      status: "unreadable",
      score: 0,
      threshold,
      declaredAddress,
      reason: "no_address_extracted",
    };
  }

  const score = scoreAddressSimilarity(declaredAddress, extractedAddress);
  return {
    status: score >= threshold ? "matched" : "mismatch",
    score,
    threshold,
    extractedAddress,
    declaredAddress,
    method,
  };
}

export type { UtilityBillAddressEvaluationResult, UtilityBillAddressMatchStatus };
