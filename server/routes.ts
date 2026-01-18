import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

/**
 * Route Registration:
 * This function defines all the API endpoints for the backend server.
 * It uses the 'storage' interface to perform data operations.
 */
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // All application API routes should be prefixed with /api

  // Note: Most data fetching in this application is handled directly via
  // the Supabase client on the frontend to leverage Row Level Security (RLS).
  // These routes serve as extensibility points for more complex server-side logic.

  return httpServer;
}
