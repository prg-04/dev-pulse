import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ALL_SKILLS } from "@/lib/skills-dictionary";

const BodySchema = z.object({
  skills: z.array(z.string().min(1)).min(1).max(15),
  range: z.enum(["3M", "6M", "12M"]),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
  mode: z.enum(["market", "custom"]).optional(),
  marketMovers: z
    .object({
      rising: z.array(z.object({ skill: z.string(), delta: z.number() })),
      declining: z.array(z.object({ skill: z.string(), delta: z.number() })),
    })
    .optional(),
});

const allowed = new Set(ALL_SKILLS);

function fallbackSummary(skills: string[], range: string) {
  return `Over the last ${range}, ${skills.join(", ")} show varied demand. Data is sourced from HackerNews 'Who is Hiring' threads and updated daily.`;
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
  const { skills, range, data, mode, marketMovers } = parsed.data;

  for (const s of skills) {
    if (!allowed.has(s.toLowerCase())) {
      return NextResponse.json({ error: `Unknown skill: ${s}` }, { status: 400 });
    }
  }

  const isMarketView = mode === "market";

  let prompt = "";
  if (isMarketView) {
    prompt = `You are analysing real job market data. Only reference skills and counts explicitly provided in the context. Do not invent demand figures, trends, or job market statistics. If data is missing, say so.

Mode: Market overview — discuss the month's biggest movers and overall market direction.
Rising skills: ${marketMovers?.rising?.map((m) => `${m.skill} (+${m.delta}%)`).join(", ") || "none"}
Declining skills: ${marketMovers?.declining?.map((m) => `${m.skill} (${m.delta}%)`).join(", ") || "none"}

Write one paragraph (2-3 sentences) describing the most notable market shift visible in the movers above. Keep tone concise and factual.`;
  } else {
    prompt = `You are analysing real job market data. Only reference skills and counts explicitly provided in the context. Do not invent demand figures, trends, or job market statistics. If data is missing, say so.

Skills: ${skills.join(", ")}
Range: ${range}
Data (month, mention_count):
${JSON.stringify(data, null, 2)}

Write one paragraph (2-3 sentences) describing the most notable trend visible for the selected skills. Include inline deltas like +34% or -2% only if you can compute them from the data above. Keep tone concise and factual.`;
  }

  try {
    // Lazy import ai so build doesn't fail if provider missing
    const { generateText } = await import("ai");
    const { assertProviderConfig, createTextModel } = await import("@/lib/ai/provider");
    assertProviderConfig();
    const model = await createTextModel();

    const result = await generateText({
      model,
      system: "You are analysing real job market data. Only reference skills and counts explicitly provided in the context. Do not invent demand figures, trends, or job market statistics. If data is missing, say so.",
      prompt,
      maxOutputTokens: 200,
    });

    const summary = result?.text?.trim() || fallbackSummary(skills, range);
    return NextResponse.json({ summary });
  } catch {
    // If AI call fails (missing gateway key, provider error), fallback
    return NextResponse.json({ summary: fallbackSummary(skills, range) });
  }
}
