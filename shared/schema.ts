import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, numeric, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["buyer", "renter", "seller", "agent", "admin"] }).default("buyer"),
  isVerified: boolean("is_verified").default(false),
  avatar: text("avatar"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  }>(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  price: text("price").notNull(),
  turnaround: text("turnaround").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProfileSchema = createInsertSchema(profiles);
export const insertPropertySchema = createInsertSchema(properties);
export const insertServiceSchema = createInsertSchema(services);

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Service = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;

// Keep legacy User type for backward compatibility if needed, but point to Profile
export type User = Profile;
export type InsertUser = InsertProfile;
