import { apiRequest } from "@/lib/queryClient";

export type HiringServiceTrack =
  | "land_surveying"
  | "real_estate_valuation"
  | "land_verification"
  | "snagging";

export type HiringApplicationStatus = "submitted" | "under_review" | "approved" | "rejected";

export type HiringApplicationDocument = {
  bucketId: string;
  storagePath: string;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
  previewUrl?: string;
};

export type HiringApplication = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  serviceTrack: HiringServiceTrack;
  yearsExperience: number;
  licenseId: string;
  portfolioUrl?: string;
  summary: string;
  applicantUserId?: string;
  status: HiringApplicationStatus;
  reviewerNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  documents: HiringApplicationDocument[];
  createdAt: string;
  updatedAt: string;
};

export type CreateHiringApplicationPayload = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  serviceTrack: HiringServiceTrack;
  yearsExperience: number;
  licenseId: string;
  portfolioUrl?: string;
  summary: string;
  applicantUserId?: string;
  consentedToChecks: boolean;
  documents?: File[];
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Failed to read file "${file.name}".`));
        return;
      }
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    };
    reader.onerror = () => reject(new Error(`Failed to read file "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

export async function createHiringApplication(
  payload: CreateHiringApplicationPayload,
): Promise<HiringApplication> {
  const { documents = [], ...rest } = payload;
  const encodedDocuments = await Promise.all(
    documents.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type || undefined,
      fileSizeBytes: file.size,
      contentBase64: await fileToBase64(file),
    })),
  );

  const response = await apiRequest("POST", "/api/hiring/applications", {
    ...rest,
    documents: encodedDocuments,
  });
  return response.json();
}

export async function fetchAdminHiringApplications(): Promise<HiringApplication[]> {
  const response = await apiRequest("GET", "/api/admin/hiring-applications");
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as HiringApplication[]) : [];
}

export async function updateAdminHiringApplicationStatus(
  id: string,
  payload: {
    status: HiringApplicationStatus;
    reviewerNotes?: string;
    reviewerId?: string;
    reviewerName?: string;
  },
): Promise<HiringApplication> {
  const response = await apiRequest(
    "PATCH",
    `/api/admin/hiring-applications/${encodeURIComponent(id)}/status`,
    {
      status: payload.status,
      reviewerNotes: payload.reviewerNotes,
      reviewerId: payload.reviewerId,
      reviewerName: payload.reviewerName,
    },
  );
  return response.json();
}
