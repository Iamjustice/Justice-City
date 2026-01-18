import {
  type Profile, type InsertProfile,
  type Property, type InsertProperty,
  type Service, type InsertService,
  type Conversation, type InsertConversation,
  type Message, type InsertMessage,
  type ServiceRequest, type InsertServiceRequest,
  profiles, properties, services, conversations, messages, serviceRequests
} from "@shared/schema";
import { db } from "./db";
import { eq, or, and } from "drizzle-orm";

/**
 * Storage Interface:
 * Defines the contract for all data operations (CRUD) in the application.
 */
export interface IStorage {
  // Profile operations
  getProfile(id: string): Promise<Profile | undefined>;
  createProfile(profile: InsertProfile): Promise<Profile>;
  updateProfile(id: string, profile: Partial<InsertProfile>): Promise<Profile>;

  // Property operations
  getProperties(): Promise<Property[]>;
  getProperty(id: string): Promise<Property | undefined>;
  getPropertiesByOwner(ownerId: string): Promise<Property[]>;
  createProperty(property: InsertProperty): Promise<Property>;

  // Service operations
  getServices(): Promise<Service[]>;

  // Chat operations
  getConversations(userId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  findConversation(user1Id: string, user2Id: string, propertyId?: string): Promise<Conversation | undefined>;
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  getMessages(conversationId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;

  // Service Request operations
  getServiceRequests(userId: string): Promise<ServiceRequest[]>;
  createServiceRequest(request: InsertServiceRequest): Promise<ServiceRequest>;
}

/**
 * DatabaseStorage Implementation:
 * Uses Drizzle ORM to perform operations against the PostgreSQL database.
 */
export class DatabaseStorage implements IStorage {
  async getProfile(id: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, id));
    return profile;
  }

  async createProfile(insertProfile: InsertProfile): Promise<Profile> {
    const [profile] = await db.insert(profiles).values(insertProfile).returning();
    return profile;
  }

  async updateProfile(id: string, partialProfile: Partial<InsertProfile>): Promise<Profile> {
    const [profile] = await db
      .update(profiles)
      .set(partialProfile)
      .where(eq(profiles.id, id))
      .returning();
    if (!profile) throw new Error("Profile not found");
    return profile;
  }

  async getProperties(): Promise<Property[]> {
    return await db.select().from(properties);
  }

  async getProperty(id: string): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property;
  }

  async getPropertiesByOwner(ownerId: string): Promise<Property[]> {
    return await db.select().from(properties).where(eq(properties.ownerId, ownerId));
  }

  async createProperty(insertProperty: InsertProperty): Promise<Property> {
    const [property] = await db.insert(properties).values(insertProperty).returning();
    return property;
  }

  async getServices(): Promise<Service[]> {
    return await db.select().from(services);
  }

  async getConversations(userId: string): Promise<Conversation[]> {
    return await db.select()
      .from(conversations)
      .where(or(eq(conversations.participant1Id, userId), eq(conversations.participant2Id, userId)));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversation;
  }

  async findConversation(user1Id: string, user2Id: string, propertyId?: string): Promise<Conversation | undefined> {
    const conditions = [
      or(
        and(eq(conversations.participant1Id, user1Id), eq(conversations.participant2Id, user2Id)),
        and(eq(conversations.participant1Id, user2Id), eq(conversations.participant2Id, user1Id))
      )
    ];
    if (propertyId) {
      conditions.push(eq(conversations.propertyId, propertyId));
    }

    const [conversation] = await db.select()
      .from(conversations)
      .where(and(...conditions));
    return conversation;
  }

  async createConversation(conversation: InsertConversation): Promise<Conversation> {
    const [newConversation] = await db.insert(conversations).values(conversation).returning();
    return newConversation;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return await db.select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [newMessage] = await db.insert(messages).values(message).returning();
    // Update conversation's updatedAt timestamp
    await db.update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, message.conversationId));
    return newMessage;
  }

  async getServiceRequests(userId: string): Promise<ServiceRequest[]> {
    return await db.select()
      .from(serviceRequests)
      .where(eq(serviceRequests.userId, userId));
  }

  async createServiceRequest(request: InsertServiceRequest): Promise<ServiceRequest> {
    const [newRequest] = await db.insert(serviceRequests).values(request).returning();
    return newRequest;
  }
}

export const storage = new DatabaseStorage();
