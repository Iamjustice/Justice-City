import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRole = pgEnum("user_role", ["buyer", "seller", "agent", "admin", "owner", "renter"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);

// NOTE: This schema mirrors the core Supabase domain tables used by the app.
// Source of truth for production remains Supabase SQL migrations in `supabase/*.sql`.
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  fullName: text("full_name"),
  email: text("email"),
  role: userRole("role").default("buyer"),
  status: userStatus("status").default("active"),
  isVerified: boolean("is_verified").default(false),
  avatarUrl: text("avatar_url"),
  phone: text("phone"),
  emailVerified: boolean("email_verified").notNull().default(false),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  gender: text("gender"),
  dateOfBirth: text("date_of_birth"),
  homeAddress: text("home_address"),
  officeAddress: text("office_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listings = pgTable("listings", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingCode: text("listing_code"),
  agentId: uuid("agent_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  listingType: text("listing_type").notNull(),
  price: numeric("price", { precision: 14, scale: 2 }).notNull(),
  priceSuffix: text("price_suffix"),
  location: text("location").notNull(),
  city: text("city"),
  state: text("state"),
  country: text("country").notNull().default("Nigeria"),
  bedrooms: integer("bedrooms"),
  bathrooms: integer("bathrooms"),
  propertySizeSqm: numeric("property_size_sqm", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("draft"),
  viewsCount: integer("views_count").notNull().default(0),
  leadsCount: integer("leads_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listingVerificationCases = pgTable("listing_verification_cases", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id").notNull(),
  status: text("status").notNull().default("pending_review"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  reviewerId: uuid("reviewer_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listingVerificationSteps = pgTable("listing_verification_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  caseId: uuid("case_id").notNull(),
  stepKey: text("step_key").notNull(),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  checkedBy: uuid("checked_by"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  mode: text("mode").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  jobId: text("job_id").notNull(),
  smileJobId: text("smile_job_id"),
  message: text("message"),
  homeAddress: text("home_address"),
  officeAddress: text("office_address"),
  dateOfBirth: text("date_of_birth"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verificationDocuments = pgTable("verification_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  verificationId: uuid("verification_id").notNull(),
  documentType: text("document_type").notNull(),
  documentUrl: text("document_url").notNull(),
  bucketId: text("bucket_id"),
  storagePath: text("storage_path"),
  uploadedBy: uuid("uploaded_by"),
  mimeType: text("mime_type"),
  fileSizeBytes: numeric("file_size_bytes"),
  extractedAddress: text("extracted_address"),
  inputHomeAddress: text("input_home_address"),
  addressMatchStatus: text("address_match_status"),
  addressMatchScore: numeric("address_match_score"),
  addressMatchMethod: text("address_match_method"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatConversations = pgTable("chat_conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id"),
  subject: text("subject"),
  createdBy: uuid("created_by"),
  scope: text("scope"),
  serviceType: text("service_type"),
  status: text("status"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedReason: text("closed_reason"),
  recordFolder: text("record_folder"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  senderId: uuid("sender_id"),
  messageType: text("message_type").notNull().default("text"),
  content: text("content").notNull(),
  problemTag: text("problem_tag"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  transactionKind: text("transaction_kind").notNull(),
  closingMode: text("closing_mode"),
  status: text("status").notNull().default("initiated"),
  buyerUserId: uuid("buyer_user_id"),
  sellerUserId: uuid("seller_user_id"),
  agentUserId: uuid("agent_user_id"),
  providerUserId: uuid("provider_user_id"),
  currency: text("currency").notNull().default("NGN"),
  principalAmount: numeric("principal_amount", { precision: 14, scale: 2 }),
  inspectionFeeAmount: numeric("inspection_fee_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  inspectionFeeRefundable: boolean("inspection_fee_refundable").notNull().default(true),
  inspectionFeeStatus: text("inspection_fee_status").notNull().default("not_applicable"),
  escrowReference: text("escrow_reference"),
  metadata: jsonb("metadata").notNull().default({}),
  acceptanceDueAt: timestamp("acceptance_due_at", { withTimezone: true }),
  escrowFrozen: boolean("escrow_frozen").notNull().default(false),
  escrowFrozenAt: timestamp("escrow_frozen_at", { withTimezone: true }),
  escrowFrozenReason: text("escrow_frozen_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatActions = pgTable("chat_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  actionType: text("action_type").notNull(),
  targetRole: text("target_role").notNull(),
  status: text("status").notNull().default("pending"),
  payload: jsonb("payload").notNull().default({}),
  createdByUserId: uuid("created_by_user_id"),
  resolvedByUserId: uuid("resolved_by_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactionDisputes = pgTable("transaction_disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  openedByUserId: uuid("opened_by_user_id"),
  againstUserId: uuid("against_user_id"),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  resolutionTargetStatus: text("resolution_target_status"),
  resolvedByUserId: uuid("resolved_by_user_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const servicePdfJobs = pgTable("service_pdf_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  serviceRequestId: uuid("service_request_id"),
  transactionId: uuid("transaction_id"),
  status: text("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  payload: jsonb("payload").notNull().default({}),
  outputBucket: text("output_bucket").notNull().default("conversation-transcripts"),
  outputPath: text("output_path"),
  errorMessage: text("error_message"),
  createdByUserId: uuid("created_by_user_id"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serviceProviderLinks = pgTable("service_provider_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  serviceRequestId: uuid("service_request_id"),
  providerUserId: uuid("provider_user_id"),
  tokenHash: text("token_hash").notNull(),
  tokenHint: text("token_hint"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("active"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  payload: jsonb("payload").notNull().default({}),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = Pick<typeof users.$inferSelect, "id" | "username" | "password">;
