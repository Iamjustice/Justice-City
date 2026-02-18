import { sendConversationMessage } from "./chat-repository";
import {
  completeDirectTransactionByTimeout,
  listDirectAcceptanceTimeoutCandidates,
  processNextServicePdfJob,
} from "./service-automation-repository";

type Logger = (message: string, source?: string) => void;

const DIRECT_SWEEP_INTERVAL_MS = Math.max(
  15_000,
  Number.parseInt(String(process.env.DIRECT_TIMEOUT_SWEEP_INTERVAL_MS ?? "60000"), 10) || 60_000,
);
const PDF_SWEEP_INTERVAL_MS = Math.max(
  10_000,
  Number.parseInt(String(process.env.SERVICE_PDF_SWEEP_INTERVAL_MS ?? "30000"), 10) || 30_000,
);
const PDF_BATCH_SIZE = Math.max(
  1,
  Math.min(20, Number.parseInt(String(process.env.SERVICE_PDF_SWEEP_BATCH_SIZE ?? "5"), 10) || 5),
);

const AUTOMATION_ACTOR_USER_ID = String(process.env.AUTOMATION_ACTOR_USER_ID ?? "").trim();
const AUTOMATION_ACTOR_NAME = String(process.env.AUTOMATION_ACTOR_NAME ?? "Justice City Automation").trim();
const AUTOMATION_ACTOR_ROLE = String(process.env.AUTOMATION_ACTOR_ROLE ?? "support").trim();

function toBoolean(value: string | undefined, fallback = true): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

async function runDirectTimeoutSweep(log: Logger): Promise<void> {
  const candidates = await listDirectAcceptanceTimeoutCandidates({ limit: 100 });
  if (candidates.length === 0) return;

  let completedCount = 0;
  for (const candidate of candidates) {
    const completed = await completeDirectTransactionByTimeout({
      transactionId: candidate.id,
      actorUserId: AUTOMATION_ACTOR_USER_ID || undefined,
    });
    if (!completed) continue;
    completedCount += 1;

    if (AUTOMATION_ACTOR_USER_ID) {
      try {
        await sendConversationMessage({
          conversationId: candidate.conversationId,
          senderId: AUTOMATION_ACTOR_USER_ID,
          senderName: AUTOMATION_ACTOR_NAME,
          senderRole: AUTOMATION_ACTOR_ROLE,
          messageType: "text",
          content:
            "Delivery acceptance window elapsed with no dispute. Transaction was auto-completed by policy.",
        });
      } catch {
        // No-op: scheduler completion should not fail if notification fails.
      }
    }
  }

  if (completedCount > 0) {
    log(`auto-completed ${completedCount} direct transactions by timeout`, "automation");
  }
}

async function runServicePdfSweep(log: Logger): Promise<void> {
  let processed = 0;
  let queuedForRetry = 0;
  let failed = 0;
  let completed = 0;

  for (let index = 0; index < PDF_BATCH_SIZE; index += 1) {
    const job = await processNextServicePdfJob();
    if (!job) break;
    processed += 1;
    if (job.status === "completed") completed += 1;
    else if (job.status === "failed") failed += 1;
    else if (job.status === "queued") queuedForRetry += 1;
  }

  if (processed > 0) {
    log(
      `processed ${processed} service PDF jobs (completed=${completed}, failed=${failed}, retry=${queuedForRetry})`,
      "automation",
    );
  }
}

export function startAutomationWorkers(options?: { log?: Logger }): () => void {
  const log = options?.log ?? ((message: string) => console.log(message));
  if (!toBoolean(process.env.ENABLE_AUTOMATION_WORKERS, true)) {
    log("automation workers disabled via ENABLE_AUTOMATION_WORKERS", "automation");
    return () => undefined;
  }

  let disposed = false;
  let directSweepRunning = false;
  let pdfSweepRunning = false;

  const safeRunDirect = async () => {
    if (disposed || directSweepRunning) return;
    directSweepRunning = true;
    try {
      await runDirectTimeoutSweep(log);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown direct timeout sweep error";
      log(`direct timeout sweep failed: ${message}`, "automation");
    } finally {
      directSweepRunning = false;
    }
  };

  const safeRunPdf = async () => {
    if (disposed || pdfSweepRunning) return;
    pdfSweepRunning = true;
    try {
      await runServicePdfSweep(log);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown PDF sweep error";
      log(`service PDF sweep failed: ${message}`, "automation");
    } finally {
      pdfSweepRunning = false;
    }
  };

  void safeRunDirect();
  void safeRunPdf();

  const directTimer = setInterval(() => {
    void safeRunDirect();
  }, DIRECT_SWEEP_INTERVAL_MS);

  const pdfTimer = setInterval(() => {
    void safeRunPdf();
  }, PDF_SWEEP_INTERVAL_MS);

  log(
    `automation workers started (direct=${DIRECT_SWEEP_INTERVAL_MS}ms, servicePdf=${PDF_SWEEP_INTERVAL_MS}ms)`,
    "automation",
  );

  return () => {
    disposed = true;
    clearInterval(directTimer);
    clearInterval(pdfTimer);
  };
}

