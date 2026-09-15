import { createClient } from "@/lib/supabase/server";
import { getTrendsData, buildMonthsBack } from "@/lib/queries/trends";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const skillsParam = searchParams.get("skills");
  const monthsParam = searchParams.get("months");
  const monthsCount = Number(searchParams.get("monthsCount") ?? "12");

  const skills = skillsParam
    ? skillsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const months = monthsParam
    ? monthsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : buildMonthsBack(monthsCount);

  if (skills.length === 0) {
    return new Response(JSON.stringify({ rows: [], months }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const supabase = await createClient();
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Missing Supabase env" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const { rows } = await getTrendsData(supabase, skills, months);
  return new Response(JSON.stringify({ rows, months }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
