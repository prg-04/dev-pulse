import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { createClient } from "@/lib/supabase/server";
import { getIngestionLastUpdate, getLatestMonth } from "@/lib/queries/dashboard";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  // Defense-in-depth: server-side auth guard (middleware is first layer, RLS is third)
  try {
    const supabase = await createClient();
    if (supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) redirect("/sign-in");
    }
  } catch {
    // if env missing, fall back to allowing render (demo mode) — middleware already handles redirect when possible
  }

  let lastUpdate: string | null = null;
  try {
    const supabase = await createClient();
    if (supabase) {
      const latest = await getLatestMonth(supabase);
      if (latest) {
        lastUpdate = await getIngestionLastUpdate(supabase);
        if (!lastUpdate) lastUpdate = `${latest}-01T00:00:00Z`;
      }
    }
  } catch {}
  return (
    <div className="min-h-screen bg-[#070A14] text-white flex flex-col">
      <AppHeader />
      <div className="flex-1">{children}</div>
      <AppFooter lastUpdate={lastUpdate} />
    </div>
  );
}
