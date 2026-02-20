import { Component, type ErrorInfo, type ReactNode } from "react";

type DevErrorBoundaryProps = {
  children: ReactNode;
};

type DevErrorBoundaryState = {
  error: Error | null;
};

export default class DevErrorBoundary extends Component<
  DevErrorBoundaryProps,
  DevErrorBoundaryState
> {
  state: DevErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): DevErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // Keep full dev context in console for debugging.
      console.error("DevErrorBoundary caught:", error, info);
    }
  }

  private resetBoundary = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!import.meta.env.DEV || !this.state.error) {
      return this.props.children;
    }

    const message = String(this.state.error.message ?? "").trim() || "Unexpected runtime error";
    const stack = String(this.state.error.stack ?? "").trim();

    return (
      <div className="fixed inset-0 z-[95] bg-black/40 p-4 sm:p-6">
        <div className="mx-auto mt-8 w-full max-w-2xl overflow-hidden rounded-xl border border-amber-300 bg-white shadow-xl">
          <div className="bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">React Render Error</p>
            <p className="text-xs text-amber-700">Caught by project-owned error boundary.</p>
          </div>
          <div className="space-y-3 px-4 py-4">
            <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {message}
            </p>
            {stack ? (
              <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                {stack.split("\n").slice(0, 12).join("\n")}
              </pre>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={this.resetBoundary}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Try Continue
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
