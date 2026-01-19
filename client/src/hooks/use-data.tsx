import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  Property, Service, Conversation, Message, ServiceRequest, Profile, PropertyDocument,
  InsertMessage, InsertConversation, InsertServiceRequest
} from "@shared/schema";
import { queryClient } from "@/lib/queryClient";

/**
 * Data Fetching and Mutation Hooks:
 * Using Supabase client for data fetching to benefit from RLS.
 */

// --- Properties ---
export function useProperties() {
  return useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return data.map((p: any) => ({
        ...p,
        ownerId: p.owner_id,
        isTitleVerified: p.is_title_verified,
        createdAt: p.created_at,
      })) as Property[];
    },
  });
}

export function useProperty(id: string) {
  return useQuery<Property>({
    queryKey: ["/api/properties", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      return {
        ...data,
        ownerId: data.owner_id,
        isTitleVerified: data.is_title_verified,
        createdAt: data.created_at,
      } as Property;
    },
    enabled: !!id,
  });
}

// --- Property Documents ---
export function usePropertyDocuments(propertyId: string) {
  return useQuery<PropertyDocument[]>({
    queryKey: ["/api/properties", propertyId, "documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_documents")
        .select("*")
        .eq("property_id", propertyId);

      if (error) throw error;
      return data.map((d: any) => ({
        ...d,
        propertyId: d.property_id,
        fileUrl: d.file_url,
        documentType: d.document_type,
        isVerified: d.is_verified,
        createdAt: d.created_at,
      })) as PropertyDocument[];
    },
    enabled: !!propertyId,
  });
}

// --- File Storage ---
export function useUploadFile() {
  return useMutation({
    mutationFn: async ({ file, bucket, path }: { file: File, bucket: string, path: string }) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      return publicUrl;
    },
  });
}

// --- Services ---
export function useServices() {
  return useQuery<Service[]>({
    queryKey: ["/api/services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*");

      if (error) throw error;
      return data.map((s: any) => ({
        ...s,
        createdAt: s.created_at,
      })) as Service[];
    },
  });
}

// --- Chat ---
export function useConversations(userId?: string) {
  return useQuery<Conversation[]>({
    queryKey: ["/api/conversations", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, property:properties(*), participant1:profiles!participant1_id(*), participant2:profiles!participant2_id(*)")
        .or(`participant1_id.eq.${userId},participant2_id.eq.${userId}`)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      return data.map((c: any) => ({
        ...c,
        participant1Id: c.participant1_id,
        participant2Id: c.participant2_id,
        propertyId: c.property_id,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        participant1: c.participant1 ? {
          ...c.participant1,
          isVerified: c.participant1.is_verified,
          createdAt: c.participant1.created_at,
          updatedAt: c.participant1.updated_at,
        } : null,
        participant2: c.participant2 ? {
          ...c.participant2,
          isVerified: c.participant2.is_verified,
          createdAt: c.participant2.created_at,
          updatedAt: c.participant2.updated_at,
        } : null,
        property: c.property ? {
          ...c.property,
          ownerId: c.property.owner_id,
          isTitleVerified: c.property.is_title_verified,
          createdAt: c.property.created_at,
        } : null,
      })) as Conversation[];
    },
    enabled: !!userId,
  });
}

export function useMessages(conversationId?: string) {
  return useQuery<Message[]>({
    queryKey: ["/api/messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return data.map((m: any) => ({
        ...m,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        createdAt: m.created_at,
      })) as Message[];
    },
    enabled: !!conversationId,
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async (message: InsertMessage) => {
      const { data, error } = await supabase
        .from("messages")
        .insert([{
          conversation_id: message.conversationId,
          sender_id: message.senderId,
          content: message.content,
        }])
        .select()
        .single();

      if (error) throw error;

      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", message.conversationId);

      return {
        ...data,
        conversationId: data.conversation_id,
        senderId: data.sender_id,
        createdAt: data.created_at,
      } as Message;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", variables.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });
}

export function useStartConversation() {
  return useMutation({
    mutationFn: async (convo: InsertConversation) => {
      const { data: existing } = await supabase
        .from("conversations")
        .select("*")
        .or(`and(participant1_id.eq.${convo.participant1Id},participant2_id.eq.${convo.participant2Id}),and(participant1_id.eq.${convo.participant2Id},participant2_id.eq.${convo.participant1Id})`)
        .eq("property_id", convo.propertyId)
        .maybeSingle();

      if (existing) return {
        ...existing,
        participant1Id: existing.participant1_id,
        participant2Id: existing.participant2_id,
        propertyId: existing.property_id,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      } as Conversation;

      const { data, error } = await supabase
        .from("conversations")
        .insert([{
          participant1_id: convo.participant1Id,
          participant2_id: convo.participant2Id,
          property_id: convo.propertyId,
        }])
        .select()
        .single();

      if (error) throw error;

      return {
        ...data,
        participant1Id: data.participant1_id,
        participant2Id: data.participant2_id,
        propertyId: data.property_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      } as Conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });
}

// --- Service Requests ---
export function useServiceRequests(userId?: string) {
  return useQuery<ServiceRequest[]>({
    queryKey: ["/api/service-requests", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_requests")
        .select("*, service:services(*)")
        .eq("user_id", userId);

      if (error) throw error;

      return data.map((r: any) => ({
        ...r,
        userId: r.user_id,
        serviceId: r.service_id,
        createdAt: r.created_at,
        service: r.service ? {
          ...r.service,
          createdAt: r.service.created_at,
        } : null,
      })) as any[];
    },
    enabled: !!userId,
  });
}

export function useCreateServiceRequest() {
  return useMutation({
    mutationFn: async (request: InsertServiceRequest) => {
      const { data, error } = await supabase
        .from("service_requests")
        .insert([{
          user_id: request.userId,
          service_id: request.serviceId,
          details: request.details,
          status: request.status,
        }])
        .select()
        .single();

      if (error) throw error;

      return {
        ...data,
        userId: data.user_id,
        serviceId: data.service_id,
        createdAt: data.created_at,
      } as ServiceRequest;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-requests"] });
    },
  });
}

// --- Profiles ---
export function useProfile(id?: string) {
  return useQuery<Profile>({
    queryKey: ["/api/profiles", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      return {
        ...data,
        isVerified: data.is_verified,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      } as Profile;
    },
    enabled: !!id,
  });
}
