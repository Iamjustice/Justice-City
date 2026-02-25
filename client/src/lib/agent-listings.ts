import { apiRequest } from "@/lib/queryClient";

export type AgentListingStatus =
  | "Draft"
  | "Pending Review"
  | "Published"
  | "Archived"
  | "Sold"
  | "Rented";
export type AgentPayoutStatus = "Pending" | "Paid";
export type AgentListingVerificationStepStatus =
  | "completed"
  | "in_progress"
  | "pending"
  | "blocked";

export type AgentListingVerificationStep = {
  key: string;
  label: string;
  description: string;
  status: AgentListingVerificationStepStatus;
  checkedAt?: string;
};

export type AgentListing = {
  id: string;
  agentId?: string;
  title: string;
  listingType: "Sale" | "Rent";
  location: string;
  description: string;
  status: AgentListingStatus;
  views: number;
  inquiries: number;
  price: string;
  date: string;
  dealAmount?: number;
  totalCommission?: number;
  agentCommission?: number;
  companyCommission?: number;
  agentPayoutStatus?: AgentPayoutStatus;
  closedAt?: string;
  verificationSteps?: AgentListingVerificationStep[];
};

export type UpsertAgentListingInput = {
  title: string;
  listingType: "Sale" | "Rent";
  location: string;
  description?: string;
  price: string | number;
  status?: AgentListingStatus;
};

type ListingUploadFileInput = {
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
  contentBase64: string;
};

export type UploadListingAssetsInput = {
  propertyDocuments?: File[];
  ownershipAuthorizationDocuments?: File[];
  images?: File[];
};

export type UploadListingAssetsResult = {
  propertyDocumentsUploaded: number;
  ownershipAuthorizationUploaded: number;
  imagesUploaded: number;
  listingId: string;
};

type ListingActor = {
  actorId: string;
  actorRole?: string;
  actorName?: string;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to read "${file.name}".`));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

async function toUploadFiles(files: File[] | undefined): Promise<ListingUploadFileInput[]> {
  const source = Array.isArray(files) ? files : [];
  if (source.length === 0) return [];

  return Promise.all(
    source.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type || undefined,
      fileSizeBytes: Number.isFinite(file.size) ? file.size : undefined,
      contentBase64: await fileToDataUrl(file),
    })),
  );
}

export async function fetchAgentListings(actor: ListingActor): Promise<AgentListing[]> {
  const params = new URLSearchParams({ actorId: actor.actorId });
  if (actor.actorRole) params.set("actorRole", actor.actorRole);
  if (actor.actorName) params.set("actorName", actor.actorName);

  const response = await apiRequest("GET", `/api/agent/listings?${params.toString()}`);
  return response.json();
}

export async function createAgentListing(
  input: UpsertAgentListingInput,
  actor: ListingActor,
): Promise<AgentListing> {
  const response = await apiRequest("POST", "/api/agent/listings", {
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    actorName: actor.actorName,
    title: input.title,
    listingType: input.listingType,
    location: input.location,
    description: input.description,
    price: input.price,
    status: input.status ?? "Pending Review",
  });

  return response.json();
}

export async function updateAgentListing(
  listingId: string,
  input: UpsertAgentListingInput,
  actor: ListingActor,
): Promise<AgentListing> {
  const response = await apiRequest("PATCH", `/api/agent/listings/${encodeURIComponent(listingId)}`, {
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    actorName: actor.actorName,
    title: input.title,
    listingType: input.listingType,
    location: input.location,
    description: input.description,
    price: input.price,
    status: input.status ?? "Draft",
  });

  return response.json();
}

export async function deleteAgentListing(
  listingId: string,
  actor: ListingActor,
): Promise<{ ok: true; listingId: string }> {
  const response = await apiRequest("DELETE", `/api/agent/listings/${encodeURIComponent(listingId)}`, {
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    actorName: actor.actorName,
  });

  return response.json();
}

export async function updateAgentListingStatus(
  listingId: string,
  status: AgentListingStatus,
  actor: ListingActor,
): Promise<AgentListing> {
  const response = await apiRequest("PATCH", `/api/agent/listings/${encodeURIComponent(listingId)}/status`, {
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    actorName: actor.actorName,
    status,
  });

  return response.json();
}

export async function updateAgentListingPayoutStatus(
  listingId: string,
  payoutStatus: AgentPayoutStatus,
  actor: ListingActor,
): Promise<AgentListing> {
  const response = await apiRequest("PATCH", `/api/agent/listings/${encodeURIComponent(listingId)}/payout`, {
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    actorName: actor.actorName,
    payoutStatus,
  });

  return response.json();
}

export async function updateAgentListingVerificationStepStatus(
  listingId: string,
  stepKey: string,
  status: AgentListingVerificationStepStatus,
  actor: ListingActor,
): Promise<AgentListing> {
  const response = await apiRequest(
    "PATCH",
    `/api/agent/listings/${encodeURIComponent(listingId)}/verification-steps/${encodeURIComponent(stepKey)}`,
    {
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      actorName: actor.actorName,
      status,
    },
  );

  return response.json();
}

export async function uploadAgentListingAssets(
  listingId: string,
  input: UploadListingAssetsInput,
  actor: ListingActor,
): Promise<UploadListingAssetsResult> {
  const response = await apiRequest(
    "POST",
    `/api/agent/listings/${encodeURIComponent(listingId)}/assets`,
    {
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      actorName: actor.actorName,
      propertyDocuments: await toUploadFiles(input.propertyDocuments),
      ownershipAuthorizationDocuments: await toUploadFiles(input.ownershipAuthorizationDocuments),
      images: await toUploadFiles(input.images),
    },
  );

  return response.json();
}
