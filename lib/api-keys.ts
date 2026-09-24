import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { getSupabaseUrl, getSupabaseServiceRoleKey } from "@/lib/supabase/env";

// Server-only helpers per §12e — never import in client components.
// Hash = sha256(raw + API_KEY_PEPPER) hex.

function getPepper(): string {
  const p = process.env.API_KEY_PEPPER;
  if (!p) throw new Error("Missing API_KEY_PEPPER");
  return p;
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const random = randomBytes(16).toString("hex");
  const raw = `dp_live_${random}`;
  const prefix = raw.slice(0, 12);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

export function hashKey(raw: string): string {
  const pepper = getPepper();
  return createHash("sha256").update(raw + pepper).digest("hex");
}

export function verifyHashMatches(raw: string, storedHash: string): boolean {
  const h = hashKey(raw);
  if (h.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}

export async function resolveUserFromBearer(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const raw = auth.slice("Bearer ".length).trim();
  if (!raw.startsWith("dp_live_")) return null;
  let hash: string;
  try {
    hash = hashKey(raw);
  } catch {
    return null;
  }
  const url = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!url || !serviceKey) return null;
  const admin = createAnonClient(url, serviceKey);
  const { data } = await admin.from("api_keys").select("user_id, revoked_at, key_hash").eq("key_hash", hash).maybeSingle();
  const row = data as { user_id?: string; revoked_at?: string | null; key_hash?: string } | null;
  if (!row || row.revoked_at) return null;
  // update last_used_at best-effort (not blocking)
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", hash);
  return row.user_id ?? null;
}

function createAnonClient(url: string, key: string): SupabaseClient {
  return createClient(url, key);
}
