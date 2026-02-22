import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";

function hasAuthorizationHeader(headers?: HeadersInit): boolean {
  if (!headers) return false;

  if (headers instanceof Headers) {
    return headers.has("Authorization");
  }

  if (Array.isArray(headers)) {
    return headers.some(([key]) => String(key).toLowerCase() === "authorization");
  }

  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { headers?: HeadersInit },
): Promise<Response> {
  const shouldReuseProvidedAuth = hasAuthorizationHeader(options?.headers);
  const supabase = shouldReuseProvidedAuth ? null : getSupabaseClient();
  const accessToken = supabase
    ? String((await supabase.auth.getSession()).data.session?.access_token ?? "").trim()
    : "";

  const headers: HeadersInit = {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(options?.headers ?? {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const supabase = getSupabaseClient();
    const accessToken =
      supabase
        ? String((await supabase.auth.getSession()).data.session?.access_token ?? "").trim()
        : "";

    const res = await fetch(queryKey.join("/") as string, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
