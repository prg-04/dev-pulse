import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api-keys";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing env" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase
    .from("api_keys")
    .select("key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data });
}

export async function POST() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing env" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: string, prefix: string, hash: string;
  try {
    const g = generateApiKey();
    raw = g.raw;
    prefix = g.prefix;
    hash = g.hash;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "key generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Revoke any existing active keys before issuing a new one
  const { error: revokeError } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("revoked_at", null);
  if (revokeError) return NextResponse.json({ error: revokeError.message }, { status: 500 });

  const { error } = await supabase.from("api_keys").insert({ user_id: user.id, key_prefix: prefix, key_hash: hash });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return raw exactly once
  return NextResponse.json({ raw, prefix, notice: "Copy this now — you won't see it again. Regenerate invalidates previous key." });
}
