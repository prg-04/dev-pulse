import { createYouTubeClient } from "@/lib/youtube/client";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

async function main() {
  // 1. Search YouTube
  const client = createYouTubeClient();
  const candidates = await client.searchVideos("React", 1);
  console.log(`YouTube candidates found: ${candidates.length}`);
  if (candidates.length > 0) {
    console.log(`Top candidate: ${candidates[0].title} (${candidates[0].video_id})`);
  }

  // 2. Read today's row from youtube_daily_usage
  const supabase = createServiceRoleClient();
  if (!supabase) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const { data, error } = await supabase
    .from("youtube_daily_usage")
    .select("*")
    .eq("usage_date", today)
    .maybeSingle();

  if (error) {
    console.error("Failed to read youtube_daily_usage:", error.message);
    process.exit(1);
  }

  console.log(`Today's youtube_daily_usage row:`, data ?? "(no row yet)");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
