import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, numeric, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Profiles table: Stores extended user information linked to Supabase Auth.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["buyer", "renter", "seller", "agent", "admin"] }).default("buyer"),
  isVerified: boolean("is_verified").default(false),
  avatar: text("avatar"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Properties table: Stores all real estate listings.
 */
export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  price: numeric("price").notNull(),
  location: text("location").notNull(),
  type: text("type", { enum: ["Sale", "Rent"] }).notNull(),
  status: text("status", { enum: ["Published", "Pending", "Sold"] }).notNull().default("Published"),
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: integer("bathrooms").notNull(),
  sqft: integer("sqft").notNull(),
  image: text("image").notNull(),
  agent: jsonb("agent").notNull().$type<{
    name: string;
    verified: boolean;
    image: string;
    id: string; // Added ID to link to profiles
  }>(),
  description: text("description").notNull(),
  ownerId: uuid("owner_id").references(() => profiles.id), // Added link to owner
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Services table: Stores professional services.
 */
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  price: text("price").notNull(),
  turnaround: text("turnaround").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Conversations table: Groups messages between two users regarding a property.
 */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  participant1Id: uuid("participant1_id").references(() => profiles.id).notNull(),
  participant2Id: uuid("participant2_id").references(() => profiles.id).notNull(),
  propertyId: uuid("property_id").references(() => properties.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Messages table: Individual messages within a conversation.
 */
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id).notNull(),
  senderId: uuid("sender_id").references(() => profiles.id).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Service Requests table: Tracks user bookings for professional services.
 */
export const serviceRequests = pgTable("service_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  serviceId: uuid("service_id").references(() => services.id).notNull(),
  details: text("details"),
  status: text("status", { enum: ["Pending", "In Progress", "Completed", "Cancelled"] }).default("Pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Zod schemas
export const insertProfileSchema = createInsertSchema(profiles);
export const insertPropertySchema = createInsertSchema(properties);
export const insertServiceSchema = createInsertSchema(services);
export const insertConversationSchema = createInsertSchema(conversations);
export const insertMessageSchema = createInsertSchema(messages);
export const insertServiceRequestSchema = createInsertSchema(serviceRequests);

// TypeScript types
export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Service = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type InsertServiceRequest = z.infer<typeof insertServiceRequestSchema>;

// Legacy support
export type User = Profile;
export type InsertUser = InsertProfile;
