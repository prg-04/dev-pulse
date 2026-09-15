import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getSupabaseServiceRoleKey } from "./env";

export function createServiceRoleClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  console.log("[service-role] url:", url, "key present:", !!key, "key prefix:", key?.slice(0, 12));
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
