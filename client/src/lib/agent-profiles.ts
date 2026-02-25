import { apiRequest } from "@/lib/queryClient";
import { type Property, MOCK_PROPERTIES } from "@/lib/mock-data";

export type AgentDashboardProfile = {
  userId: string;
  displayName?: string;
  bio?: string;
  salesRating: number;
  reviewCount: number;
  recentDealsCount: number;
  closedDealsCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export async function fetchAgentProfile(userId: string): Promise<AgentDashboardProfile> {
  const response = await apiRequest("GET", `/api/agent-profiles/${encodeURIComponent(userId)}`);
  return response.json();
}

export async function updateAgentProfile(
  userId: string,
  input: { displayName?: string; bio?: string },
): Promise<AgentDashboardProfile> {
  const payload: Record<string, unknown> = {};
  if (typeof input.displayName === "string") {
    payload.displayName = input.displayName;
  }
  if (typeof input.bio === "string") {
    payload.bio = input.bio;
  }
  const response = await apiRequest(
    "PATCH",
    `/api/agent-profiles/${encodeURIComponent(userId)}`,
    payload,
  );
  return response.json();
}

export type AgentPublicProfile = {
  name: string;
  image: string;
  verified: boolean;
  salesRating: number;
  totalReviews: number;
  totalClosedDeals: number;
  reviews: {
    id: string;
    reviewer: string;
    rating: number;
    comment: string;
    date: string;
  }[];
  recentDeals: {
    id: string;
    title: string;
    location: string;
    price: number;
  }[];
  closedDeals: {
    id: string;
    title: string;
    location: string;
    closedValue: number;
    closedAt: string;
  }[];
};

const REVIEWERS = [
  "Amina Yusuf",
  "Daniel Okafor",
  "Grace Nwosu",
  "Femi Adesina",
  "Ijeoma Eze",
  "Mariam Bello",
];

const REVIEW_COMMENTS = [
  "Professional and transparent throughout the process.",
  "Very responsive and clear with documentation updates.",
  "Handled negotiations well and closed on schedule.",
  "Provided accurate property details and market insights.",
  "Reliable from first viewing to final agreement.",
  "Strong follow-up and excellent process guidance.",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function formatRelativeDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function pickAgentProperties(agentName: string): Property[] {
  const matches = MOCK_PROPERTIES.filter((item) => item.agent.name === agentName);
  if (matches.length > 0) return matches;
  return MOCK_PROPERTIES.slice(0, 3);
}

export function getAgentPublicProfile(input: {
  name: string;
  image: string;
  verified: boolean;
}): AgentPublicProfile {
  const seed = hashString(input.name);
  const baseRating = 42 + (seed % 9); // 4.2 - 5.0
  const salesRating = Number((baseRating / 10).toFixed(1));
  const totalReviews = 18 + (seed % 140);
  const totalClosedDeals = 10 + (seed % 85);
  const agentProperties = pickAgentProperties(input.name);

  const recentDeals = agentProperties.slice(0, 3).map((item, index) => ({
    id: `${input.name}-recent-${index}`,
    title: item.title,
    location: item.location,
    price: item.price,
  }));

  const closedDeals = agentProperties.slice(0, 3).map((item, index) => ({
    id: `${input.name}-closed-${index}`,
    title: item.title,
    location: item.location,
    closedValue: Math.round(item.price * (0.92 + ((seed + index) % 8) / 100)),
    closedAt: formatRelativeDate(20 + ((seed + index * 7) % 120)),
  }));

  const reviews = Array.from({ length: 3 }).map((_, index) => {
    const reviewer = REVIEWERS[(seed + index) % REVIEWERS.length];
    const comment = REVIEW_COMMENTS[(seed + index) % REVIEW_COMMENTS.length];
    const ratingOffset = ((seed + index) % 3) * 0.1;
    const rating = Number(Math.max(4, Math.min(5, salesRating - 0.2 + ratingOffset)).toFixed(1));

    return {
      id: `${input.name}-review-${index}`,
      reviewer,
      rating,
      comment,
      date: formatRelativeDate(7 + ((seed + index * 11) % 90)),
    };
  });

  return {
    name: input.name,
    image: input.image,
    verified: input.verified,
    salesRating,
    totalReviews,
    totalClosedDeals,
    reviews,
    recentDeals,
    closedDeals,
  };
}
