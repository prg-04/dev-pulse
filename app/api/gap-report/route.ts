import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { marketAlignmentPct } from "@/lib/matching";
import { mockGapReport, mockGapReportTutorialsNote } from "@/lib/mock/gap-report";
import { createClient } from "@/lib/supabase/server";
import { normalizeSkill } from "@/lib/skills-dictionary";

const BodySchema = z.object({
  target_role: z.string().optional(),
  skills: z.array(z.string().min(1)).min(1).max(16),
  include_tutorials: z.boolean().optional().default(true),
});

function normalizeSkills(skills: string[]): string[] {
  const canonicalized = skills
    .map((s) => normalizeSkill(s.trim()))
    .filter((s): s is string => Boolean(s));
  return [...new Set(canonicalized)];
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { target_role, skills: rawSkills } = parsed.data;
  const skills = normalizeSkills(rawSkills);
  if (skills.length === 0) {
    return NextResponse.json({ error: "No known skills provided" }, { status: 400 });
  }

  // Auth check must come before any Supabase read or write (AGENTS §3)
  const supabaseAuth = await createClient();
  if (!supabaseAuth) {
    return NextResponse.json({ error: "Missing env" }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Try to load live data for deterministic computation
  let marketAlignment = mockGapReport.marketAlignmentPct;
  let strengths = mockGapReport.strengths;
  let gaps = mockGapReport.gaps;
  let rising = mockGapReport.rising;
  let declining = mockGapReport.declining;
  let totalPostings = mockGapReport.totalPostings;
  let monthLabel = mockGapReport.monthLabel;

  let top50: { skill: string; mention_count: number }[] = [];
  try {
    const supabase = await createClient();
    if (supabase) {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const { data: snapshot } = await supabase
        .from("skill_demand_snapshots")
        .select("skill, mention_count")
        .eq("month", month)
        .order("mention_count", { ascending: false })
        .limit(50);
      if (snapshot && snapshot.length > 0) {
        top50 = snapshot as typeof top50;
        marketAlignment = marketAlignmentPct(skills, top50);
        const skillSet = new Set(skills);
        // strengths: user skills that are in top 50 and high volume
        strengths = top50
          .filter((r) => {
            const canon = normalizeSkill(r.skill) ?? r.skill.toLowerCase();
            return skillSet.has(canon);
          })
          .slice(0, 5)
          .map((r) => {
            const canon = normalizeSkill(r.skill) ?? r.skill.toLowerCase();
            return { skill: canon, count: r.mention_count };
          });
        gaps = top50
          .filter((r) => {
            const canon = normalizeSkill(r.skill) ?? r.skill.toLowerCase();
            return !skillSet.has(canon);
          })
          .slice(0, 3)
          .map((r) => {
            const canon = normalizeSkill(r.skill) ?? r.skill.toLowerCase();
            return { skill: canon, count: r.mention_count };
          });

        // history for rising/declining: last 2 months
        const months: string[] = [];
        for (let i = 1; i >= 0; i--) {
          const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
        }
        const { data: hist } = await supabase
          .from("skill_demand_snapshots")
          .select("skill, month, mention_count")
          .in("month", months)
          .order("month", { ascending: true });
        if (hist && hist.length > 0) {
          const bySkill: Record<string, number[]> = {};
          for (const row of hist as { skill: string; month: string; mention_count: number }[]) {
            if (!bySkill[row.skill]) bySkill[row.skill] = [];
            // ensure ordered by months array order - hist already ordered
          }
          // group by skill with 2 values
          const map: Record<string, { prev: number; last: number }> = {};
          for (const r of hist as { skill: string; month: string; mention_count: number }[]) {
            if (!map[r.skill]) map[r.skill] = { prev: 0, last: 0 };
            if (r.month === months[0]) map[r.skill].prev = r.mention_count;
            if (r.month === months[1]) map[r.skill].last = r.mention_count;
          }
          const deltas = Object.entries(map)
            .map(([skill, v]) => {
              const delta = v.prev === 0 ? (v.last > 0 ? 100 : 0) : Math.round(((v.last - v.prev) / v.prev) * 100);
              return { skill, delta };
            })
            .filter((d) => d.delta !== 0);
          rising = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
          declining = deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);
        }

        // total postings for this month: count job_postings ingested_at in month? fallback to sum counts
        const { count } = await supabase
          .from("job_postings")
          .select("id", { count: "exact", head: true });
        if (typeof count === "number" && count > 0) totalPostings = count;
        monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      }
    }
  } catch {
    // fallback to mock
  }

  // Persist snapshot + gap events (auth already validated above)
  try {
    const supabase = await createClient();
    if (supabase) {
      await supabase.from("user_skill_profiles").insert({
        user_id: user.id,
        target_role: target_role ?? null,
        skills,
      });
      if (gaps.length > 0) {
        const events = gaps.map((g) => ({
          user_id: user.id,
          skill: normalizeSkill(g.skill) ?? g.skill.toLowerCase(),
        }));
        await supabase.from("gap_report_events").insert(events);
      }
    }
  } catch {
    // ignore persistence errors
  }

  // AI synthesis for recommendations - grounded, fallback to mock if missing
  let recommendations = mockGapReport.recommendations;
  try {
    const { generateText } = await import("ai");
    const { assertProviderConfig, createTextModel } = await import("@/lib/ai/provider");
    assertProviderConfig();
    const model = await createTextModel();
    const prompt = `You are analysing real job market data. Only reference skills and counts explicitly provided. Do not invent demand figures.

User skills: ${skills.join(", ")}
Market alignment: ${marketAlignment}%
Strengths: ${strengths.map((s) => `${s.skill} (${s.count})`).join(", ")}
Gaps (missing high-demand): ${gaps.map((g) => `${g.skill} (${g.count})`).join(", ")}
Rising: ${rising.map((r) => `${r.skill} (+${r.delta}%)`).join(", ")}
Declining: ${declining.map((d) => `${d.skill} (${d.delta}%)`).join(", ")}
Month: ${monthLabel}, total postings: ${totalPostings}

Return exactly 3 numbered recommendations as JSON array of strings, each one sentence, actionable, referencing only the data above. Example: ["...", "...", "..."]`;
    const result = await generateText({
      model,
      system: "You are analysing real job market data. Only reference skills and counts explicitly provided in the context. Do not invent demand figures, trends, or job market statistics. If data is missing, say so.",
      prompt,
      maxOutputTokens: 300,
    });
    const text = result?.text?.trim() ?? "";
    // try parse JSON array
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]) as unknown;
      if (Array.isArray(arr) && arr.length >= 3 && arr.every((x) => typeof x === "string")) {
        recommendations = (arr as string[]).slice(0, 3);
      }
    }
  } catch {
    // keep fallback
  }

  return NextResponse.json({
    market_alignment_pct: marketAlignment,
    index: marketAlignment / 100,
    target_baseline: mockGapReport.targetBaseline,
    top_tier_threshold: mockGapReport.topTierThreshold,
    strengths,
    strengths_summary: mockGapReport.strengthsSummary,
    gaps,
    rising,
    rising_summary: mockGapReport.risingSummary,
    declining,
    declining_summary: mockGapReport.decliningSummary,
    recommendations,
    tutorials_note: mockGapReportTutorialsNote,
    month_label: monthLabel,
    total_postings: totalPostings,
    evaluated_skills: skills,
  });
}
