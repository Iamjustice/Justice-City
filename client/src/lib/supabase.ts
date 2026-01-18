import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Client Initialization:
 * This file creates and exports a singleton instance of the Supabase client.
 * it uses environment variables for the URL and Anonymous Key.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail early if configuration is missing
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// The client is configured to use the public 'anon' role by default
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
