import { useEffect, useState } from "react";

const HIDE_KEY = "jc_dev_helper_banner_hidden";

export default function DevHelperBanner() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const stored = window.localStorage.getItem(HIDE_KEY);
    setHidden(stored === "1");
  }, []);

  if (!import.meta.env.DEV || hidden) return null;

  const hideBanner = () => {
    window.localStorage.setItem(HIDE_KEY, "1");
    setHidden(true);
  };

  return (
    <div className="fixed bottom-3 left-3 right-3 z-[90]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-900">Dev Helper Tools (Local)</p>
          <p className="text-xs text-emerald-700">
            Quick links, status indicator, and run command hints for non-Replit development.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a href="/" className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-emerald-800">
            Home
          </a>
          <a
            href="/auth"
            className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-emerald-800"
          >
            Auth
          </a>
          <a
            href="/verify"
            className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-emerald-800"
          >
            Verify
          </a>
          <span className="rounded-md bg-emerald-700 px-2 py-1 text-white">Run: npm run dev</span>
          <button
            type="button"
            onClick={hideBanner}
            className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-emerald-800"
          >
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
