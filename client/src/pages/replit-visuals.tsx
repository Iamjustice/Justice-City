import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReplitVisualsPage() {
  return (
    <div className="min-h-[90vh] bg-gradient-to-b from-slate-100 via-slate-50 to-white p-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-display font-bold text-slate-900">Replit Visual Mockups</h1>
          <p className="mt-2 text-slate-600">
            Concept visuals for runtime popup, dev banner, and one-click run workflow.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>1. Runtime Error Popup</CardTitle>
              <CardDescription>What a Replit-style runtime error modal looks like.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-slate-300 bg-slate-200 p-6">
                <div className="mx-auto max-w-md overflow-hidden rounded-lg border border-red-300 bg-white shadow-md">
                  <div className="bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
                    Runtime Error
                  </div>
                  <div className="space-y-2 px-4 py-3 font-mono text-xs text-slate-700">
                    <p>TypeError: Cannot read properties of undefined</p>
                    <p>at AuthPage (auth.tsx:91)</p>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-red-600 px-2 py-1 text-xs text-white"
                    >
                      Open file
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>2. Helper Dev Banner</CardTitle>
              <CardDescription>The in-editor helper strip with quick links and controls.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-sm text-white">
                  <span>Dev Banner: App is running on port 5000</span>
                  <div className="flex gap-2 text-xs">
                    <span className="rounded bg-emerald-700 px-2 py-1">Open</span>
                    <span className="rounded bg-emerald-700 px-2 py-1">Logs</span>
                    <span className="rounded bg-emerald-700 px-2 py-1">Hide</span>
                  </div>
                </div>
                <div className="h-40 bg-slate-100" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle>3. One-Click Run Workflow</CardTitle>
              <CardDescription>Editor view with the Run button executing a preconfigured command.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="rounded bg-slate-200 px-2 py-1 font-mono text-xs">App.tsx</span>
                    <span className="rounded bg-slate-200 px-2 py-1 font-mono text-xs">verify.tsx</span>
                    <span className="rounded bg-slate-200 px-2 py-1 font-mono text-xs">.replit</span>
                  </div>
                  <button type="button" className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white">
                    Run
                  </button>
                </div>
                <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
                  <div className="min-h-[180px] bg-slate-100 p-4 text-xs text-slate-500">
                    editor area
                  </div>
                  <div className="border-l border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-200">
                    <p>$ npm run dev</p>
                    <p>VITE v7.x ready in 623 ms</p>
                    <p>Server running at http://0.0.0.0:5000</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
