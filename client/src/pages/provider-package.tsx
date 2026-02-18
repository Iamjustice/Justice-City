import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileText, Link2 } from "lucide-react";
import {
  fetchProviderPackage,
  type ProviderPackage,
  type ProviderPackageFile,
} from "@/lib/transaction-automation";

function FileRow({ file }: { file: ProviderPackageFile }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{file.fileName}</p>
        <p className="truncate text-xs text-slate-500">{file.storagePath}</p>
      </div>
      {file.signedUrl ? (
        <a href={file.signedUrl} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline">
            Open
          </Button>
        </a>
      ) : (
        <span className="text-xs text-slate-400">Unavailable</span>
      )}
    </div>
  );
}

export default function ProviderPackagePage() {
  const [matched, params] = useRoute("/provider-package/:token");
  const token = matched ? String(params?.token ?? "").trim() : "";
  const [record, setRecord] = useState<ProviderPackage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!token) {
      setIsLoading(false);
      setError("Missing provider package token.");
      return () => undefined;
    }

    setIsLoading(true);
    setError(null);
    fetchProviderPackage(token)
      .then((payload) => {
        if (!active) return;
        setRecord(payload);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load provider package.");
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-blue-600" />
            Service Provider Package
          </CardTitle>
          <CardDescription>
            Secure access to service transcript and supporting files.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading secure package...</p>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Unable to open package
              </p>
              <p className="mt-1">{error}</p>
            </div>
          ) : !record ? (
            <p className="text-sm text-slate-500">No package data found.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p>
                  <strong>Status:</strong> {record.status}
                </p>
                <p>
                  <strong>Conversation:</strong> {record.conversationId}
                </p>
                <p>
                  <strong>Expires:</strong> {new Date(record.expiresAt).toLocaleString()}
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Transcript</h3>
                {record.transcript ? (
                  <FileRow file={record.transcript} />
                ) : (
                  <p className="text-xs text-slate-500">No transcript attached yet.</p>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Attachments</h3>
                {record.attachments.length > 0 ? (
                  <div className="space-y-2">
                    {record.attachments.map((file) => (
                      <FileRow key={`${file.bucketId}:${file.storagePath}`} file={file} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No attachments available.</p>
                )}
              </div>

              <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
                <p className="flex items-center gap-1 font-medium">
                  <FileText className="h-3.5 w-3.5" />
                  Security notice
                </p>
                <p className="mt-1">
                  This link is time-limited. Do not share these files outside authorized workflow.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

