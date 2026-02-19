import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SERVICE_OFFERINGS_TABLE =
  process.env.SUPABASE_SERVICE_OFFERINGS_TABLE || "service_offerings";

export type ServiceOfferingRecord = {
  code: string;
  name: string;
  description: string;
  icon: string;
  price: string;
  turnaround: string;
  updatedAt: string;
};

type UpdateServiceOfferingInput = {
  code: string;
  price: string;
  turnaround: string;
};

const DEFAULT_SERVICE_OFFERINGS: ServiceOfferingRecord[] = [
  {
    code: "real_estate_valuation",
    name: "Property Valuation",
    description: "Get a certified valuation report for your property from licensed estate surveyors.",
    icon: "ClipboardCheck",
    price: "NGN 50,000",
    turnaround: "48 Hours",
    updatedAt: new Date().toISOString(),
  },
  {
    code: "land_surveying",
    name: "Land Surveying",
    description: "Professional boundary surveys and topographic mapping by verified surveyors.",
    icon: "Compass",
    price: "NGN 120,000",
    turnaround: "5-7 Days",
    updatedAt: new Date().toISOString(),
  },
  {
    code: "land_verification",
    name: "Land Info Verification",
    description: "Verify land titles and historical records at the state land registry.",
    icon: "FileSearch",
    price: "NGN 35,000",
    turnaround: "24 Hours",
    updatedAt: new Date().toISOString(),
  },
  {
    code: "snagging",
    name: "Snagging Services",
    description: "Detailed inspection of new buildings to identify defects before you move in.",
    icon: "Building2",
    price: "NGN 45,000",
    turnaround: "48 Hours",
    updatedAt: new Date().toISOString(),
  },
];

let fallbackOfferings: ServiceOfferingRecord[] = DEFAULT_SERVICE_OFFERINGS.map((item) => ({ ...item }));

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isTableMissingError(error: { message?: string } | null): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
}

function isColumnMissingError(error: { message?: string } | null): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

function mapDbRowToServiceOffering(row: Record<string, unknown>): ServiceOfferingRecord {
  return {
    code: String(row.code ?? "").trim(),
    name: String(row.display_name ?? row.name ?? "Service").trim() || "Service",
    description: String(row.description ?? "").trim(),
    icon: String(row.icon_key ?? "ClipboardCheck").trim() || "ClipboardCheck",
    price: String(row.price_label ?? "").trim() || "NGN 0",
    turnaround: String(row.turnaround_label ?? "").trim() || "TBD",
    updatedAt:
      typeof row.updated_at === "string" && row.updated_at.trim()
        ? row.updated_at
        : new Date().toISOString(),
  };
}

async function ensureDefaultRows(client: SupabaseClient): Promise<void> {
  const { data: existingRows, error: existingError } = await client
    .from(SERVICE_OFFERINGS_TABLE)
    .select("code");

  if (existingError) {
    if (isTableMissingError(existingError) || isColumnMissingError(existingError)) {
      throw existingError;
    }
    throw existingError;
  }

  const existingCodes = new Set(
    (Array.isArray(existingRows) ? existingRows : []).map((row) => String(row.code ?? "").trim()),
  );

  const rowsToInsert = DEFAULT_SERVICE_OFFERINGS
    .filter((item) => !existingCodes.has(item.code))
    .map((item) => ({
      code: item.code,
      display_name: item.name,
      description: item.description,
      icon_key: item.icon,
      price_label: item.price,
      turnaround_label: item.turnaround,
    }));

  if (rowsToInsert.length === 0) return;

  const { error: insertError } = await client.from(SERVICE_OFFERINGS_TABLE).insert(rowsToInsert);

  if (insertError) {
    if (isTableMissingError(insertError) || isColumnMissingError(insertError)) {
      throw insertError;
    }
    throw insertError;
  }
}

export async function listServiceOfferings(): Promise<ServiceOfferingRecord[]> {
  const client = getClient();
  if (!client) {
    return fallbackOfferings.map((item) => ({ ...item }));
  }

  try {
    await ensureDefaultRows(client);

    const { data, error } = await client
      .from(SERVICE_OFFERINGS_TABLE)
      .select(
        "code, display_name, description, icon_key, price_label, turnaround_label, updated_at",
      )
      .order("display_name", { ascending: true });

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return fallbackOfferings.map((item) => ({ ...item }));
    }

    return rows.map((row) =>
      mapDbRowToServiceOffering(row as unknown as Record<string, unknown>),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      return fallbackOfferings.map((item) => ({ ...item }));
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to load service offerings: ${message}`);
  }
}

export async function updateServiceOffering(
  input: UpdateServiceOfferingInput,
): Promise<ServiceOfferingRecord> {
  const code = String(input.code ?? "").trim();
  const price = String(input.price ?? "").trim();
  const turnaround = String(input.turnaround ?? "").trim();
  if (!code || !price || !turnaround) {
    throw new Error("code, price, and turnaround are required.");
  }

  const client = getClient();
  if (!client) {
    const existing = fallbackOfferings.find((item) => item.code === code);
    if (!existing) {
      throw new Error("Service offering not found.");
    }

    const updated: ServiceOfferingRecord = {
      ...existing,
      price,
      turnaround,
      updatedAt: new Date().toISOString(),
    };

    fallbackOfferings = fallbackOfferings.map((item) => (item.code === code ? updated : item));
    return { ...updated };
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await client
      .from(SERVICE_OFFERINGS_TABLE)
      .update({
        price_label: price,
        turnaround_label: turnaround,
        updated_at: nowIso,
      })
      .eq("code", code)
      .select(
        "code, display_name, description, icon_key, price_label, turnaround_label, updated_at",
      )
      .maybeSingle();

    if (error) throw error;

    if (data) {
      return mapDbRowToServiceOffering(data as unknown as Record<string, unknown>);
    }

    const seeded = DEFAULT_SERVICE_OFFERINGS.find((item) => item.code === code);
    if (!seeded) {
      throw new Error("Service offering not found.");
    }

    const { data: inserted, error: insertError } = await client
      .from(SERVICE_OFFERINGS_TABLE)
      .insert({
        code: seeded.code,
        display_name: seeded.name,
        description: seeded.description,
        icon_key: seeded.icon,
        price_label: price,
        turnaround_label: turnaround,
        updated_at: nowIso,
      })
      .select(
        "code, display_name, description, icon_key, price_label, turnaround_label, updated_at",
      )
      .single();

    if (insertError) throw insertError;
    return mapDbRowToServiceOffering(inserted as unknown as Record<string, unknown>);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      const existing = fallbackOfferings.find((item) => item.code === code);
      if (!existing) {
        throw new Error("Service offering not found.");
      }
      const updated: ServiceOfferingRecord = {
        ...existing,
        price,
        turnaround,
        updatedAt: new Date().toISOString(),
      };
      fallbackOfferings = fallbackOfferings.map((item) => (item.code === code ? updated : item));
      return { ...updated };
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to update service offering: ${message}`);
  }
}
