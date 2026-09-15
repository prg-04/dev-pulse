import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ? "set" : "missing",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "set" : "missing",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "missing",
    cronSecret: process.env.CRON_SECRET ? "set" : "missing",
  });
}
