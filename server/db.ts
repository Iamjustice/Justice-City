import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@shared/schema';

/**
 * Database Initialization:
 * This file sets up the connection to the PostgreSQL database using the 'pg' library.
 * It also initializes Drizzle ORM with our shared schema for type-safe database operations.
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Please ensure the database is provisioned.",
  );
}

// Create a new connection pool using the provided connection string
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Initialize Drizzle ORM instance
export const db = drizzle(pool, { schema });
