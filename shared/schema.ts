import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const properties = pgTable("properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
});

export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  price: text("price").notNull(),
  turnaround: text("turnaround").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertPropertySchema = createInsertSchema(properties);
export const insertServiceSchema = createInsertSchema(services);

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Service = typeof services.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type InsertService = z.infer<typeof insertServiceSchema>;
