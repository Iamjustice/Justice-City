import { apiRequest } from "@/lib/queryClient";

export type ServiceOffering = {
  code: string;
  name: string;
  description: string;
  icon: string;
  price: string;
  turnaround: string;
  updatedAt: string;
};

export async function fetchServiceOfferings(): Promise<ServiceOffering[]> {
  const response = await fetch("/api/service-offerings", {
    credentials: "include",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }

  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as ServiceOffering[]) : [];
}

export async function updateAdminServiceOffering(
  code: string,
  payload: { price: string; turnaround: string; actorRole?: string },
): Promise<ServiceOffering> {
  const response = await apiRequest("PATCH", `/api/admin/service-offerings/${encodeURIComponent(code)}`, {
    price: payload.price,
    turnaround: payload.turnaround,
    actorRole: payload.actorRole,
  });

  return response.json();
}
