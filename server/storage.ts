import {
  type Profile, type InsertProfile,
  type Property, type InsertProperty,
  type Service, type InsertService,
  profiles, properties, services
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

/**
 * Storage Interface:
 * Defines the contract for all data operations (CRUD) in the application.
 * This abstraction allows us to easily swap out the storage implementation if needed.
 */
export interface IStorage {
  // Profile operations
  getProfile(id: string): Promise<Profile | undefined>;
  createProfile(profile: InsertProfile): Promise<Profile>;
  updateProfile(id: string, profile: Partial<InsertProfile>): Promise<Profile>;

  // Property operations
  getProperties(): Promise<Property[]>;
  getProperty(id: string): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;

  // Service operations
  getServices(): Promise<Service[]>;
}

/**
 * DatabaseStorage Implementation:
 * Uses Drizzle ORM to perform operations against the PostgreSQL database.
 */
export class DatabaseStorage implements IStorage {
  // Retrieve a user profile by its unique ID
  async getProfile(id: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, id));
    return profile;
  }

  // Create a new user profile record
  async createProfile(insertProfile: InsertProfile): Promise<Profile> {
    const [profile] = await db.insert(profiles).values(insertProfile).returning();
    return profile;
  }

  // Update an existing user profile's fields (e.g., verification status)
  async updateProfile(id: string, partialProfile: Partial<InsertProfile>): Promise<Profile> {
    const [profile] = await db
      .update(profiles)
      .set(partialProfile)
      .where(eq(profiles.id, id))
      .returning();
    if (!profile) throw new Error("Profile not found");
    return profile;
  }

  // Fetch all available property listings
  async getProperties(): Promise<Property[]> {
    return await db.select().from(properties);
  }

  // Retrieve a single property by its ID
  async getProperty(id: string): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property;
  }

  // Add a new property listing to the database
  async createProperty(insertProperty: InsertProperty): Promise<Property> {
    const [property] = await db.insert(properties).values(insertProperty).returning();
    return property;
  }

  // Fetch all professional services
  async getServices(): Promise<Service[]> {
    return await db.select().from(services);
  }
}

// Export a singleton instance of the storage implementation
export const storage = new DatabaseStorage();
