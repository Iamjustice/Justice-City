import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

/**
 * Route Registration:
 * Defines API endpoints for the backend server.
 */
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Properties
  app.get("/api/properties", async (_req, res) => {
    const props = await storage.getProperties();
    res.json(props);
  });

  app.get("/api/properties/:id", async (req, res) => {
    const prop = await storage.getProperty(req.params.id);
    if (!prop) return res.status(404).json({ message: "Property not found" });
    res.json(prop);
  });

  // Services
  app.get("/api/services", async (_req, res) => {
    const svcs = await storage.getServices();
    res.json(svcs);
  });

  // Chat - Conversations
  app.get("/api/conversations", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ message: "UserId required" });
    const convos = await storage.getConversations(userId);
    res.json(convos);
  });

  app.post("/api/conversations", async (req, res) => {
    const convo = await storage.createConversation(req.body);
    res.status(201).json(convo);
  });

  // Chat - Messages
  app.get("/api/messages/:conversationId", async (req, res) => {
    const msgs = await storage.getMessages(req.params.conversationId);
    res.json(msgs);
  });

  app.post("/api/messages", async (req, res) => {
    const msg = await storage.createMessage(req.body);
    res.status(201).json(msg);
  });

  // Service Requests
  app.get("/api/service-requests", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ message: "UserId required" });
    const requests = await storage.getServiceRequests(userId);
    res.json(requests);
  });

  app.post("/api/service-requests", async (req, res) => {
    const request = await storage.createServiceRequest(req.body);
    res.status(201).json(request);
  });

  return httpServer;
}
