import { useEffect, useMemo, useState } from "react";

type RuntimeIssue = {
  message: string;
  stack?: string;
  source: "error" | "promise";
  timestamp: number;
};

function shouldIgnoreIssue(text: string): boolean {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return true;
  if (/(chrome|moz|safari)-extension:\/\//i.test(normalized)) return true;
  if (normalized.includes("resizeobserver loop limit exceeded")) return true;
  if (normalized.includes("script error.")) return true;
  return false;
}

function getIssueFromPromiseRejection(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      message: String(reason.message ?? "").trim() || "Unhandled promise rejection",
      stack: String(reason.stack ?? "").trim() || undefined,
    };
  }

  if (typeof reason === "string") {
    return { message: reason.trim() || "Unhandled promise rejection" };
  }

  try {
    return { message: JSON.stringify(reason) };
  } catch {
    return { message: "Unhandled promise rejection" };
  }
}

export default function DevRuntimeOverlay() {
  const [issue, setIssue] = useState<RuntimeIssue | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return () => undefined;

    const onError = (event: ErrorEvent) => {
      const message = String(event.message ?? "Unhandled runtime error").trim();
      const stack = event.error instanceof Error ? String(event.error.stack ?? "").trim() : "";
      const joinedText = `${message}\n${stack}`;
      if (shouldIgnoreIssue(joinedText)) return;

      setIssue({
        message: message || "Unhandled runtime error",
        stack: stack || undefined,
        source: "error",
        timestamp: Date.now(),
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const parsed = getIssueFromPromiseRejection(event.reason);
      const joinedText = `${parsed.message}\n${parsed.stack ?? ""}`;
      if (shouldIgnoreIssue(joinedText)) return;

      setIssue({
        message: parsed.message,
        stack: parsed.stack,
        source: "promise",
        timestamp: Date.now(),
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const stackPreview = useMemo(() => {
    if (!issue?.stack) return "";
    const lines = issue.stack.split("\n").slice(0, 12);
    return lines.join("\n");
  }, [issue?.stack]);

  if (!import.meta.env.DEV || !issue) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/45 p-4 sm:p-6">
      <div className="mx-auto mt-6 w-full max-w-2xl overflow-hidden rounded-xl border border-red-300 bg-white shadow-xl">
        <div className="flex items-center justify-between bg-red-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-red-700">Runtime Error</p>
            <p className="text-xs text-red-600">
              Source: {issue.source === "error" ? "window.error" : "unhandledrejection"}
            </p>
          </div>
          <p className="text-xs text-red-600">{new Date(issue.timestamp).toLocaleTimeString()}</p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
            {issue.message}
          </p>
          {stackPreview ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
              {stackPreview}
            </pre>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIssue(null)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
