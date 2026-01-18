import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Property, Service } from "@shared/schema";

/**
 * Data Fetching Hooks:
 * These hooks use TanStack Query and the Supabase client to fetch data from the database.
 * They leverage PostgreSQL's Row Level Security (RLS) configured in the Supabase backend.
 */

// Fetches all available property listings, ordered by creation date
export function useProperties() {
  return useQuery<Property[]>({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Property[];
    },
  });
}

// Fetches a single property listing by its ID
export function useProperty(id: string) {
  return useQuery<Property>({
    queryKey: ["properties", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as Property;
    },
    enabled: !!id, // Only run the query if an ID is provided
  });
}

// Fetches all professional real estate services
export function useServices() {
  return useQuery<Service[]>({
    queryKey: ["services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*");

      if (error) throw error;
      return data as Service[];
    },
  });
}
