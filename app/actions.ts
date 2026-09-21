"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { indexSkillOnDemand } from "@/app/api/cron/tutorial-index/ondemand";

export async function triggerOnDemandIndexing(skill: string) {
  const supabase = createServiceRoleClient();
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (!supabase || !youtubeApiKey) {
    return { error: "Missing configuration" } as const;
  }
  try {
    const result = await indexSkillOnDemand(supabase, skill, youtubeApiKey);
    return { result } as const;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
    } as const;
  }
}
