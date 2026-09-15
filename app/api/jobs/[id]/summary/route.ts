import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { stripHtml } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

type SummaryShape = {
  about_company: string | null;
  the_role: string | null;
  what_you_will_do: string[];
  requirements: string[];
};

function fallbackSummary(description: string | null): SummaryShape {
  const text = stripHtml(description).trim();
  if (!text) return { about_company: null, the_role: null, what_you_will_do: [], requirements: [] };
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const about = sentences.slice(0, 3).join(" ").slice(0, 600) || null;
  const role = sentences.slice(3, 6).join(" ").slice(0, 600) || null;
  const bullets = sentences.slice(6, 10).map((s) => s.slice(0, 200));
  const reqs = sentences.slice(10, 14).map((s) => s.slice(0, 200));
  return {
    about_company: about,
    the_role: role,
    what_you_will_do: bullets.length > 0 ? bullets : [],
    requirements: reqs.length > 0 ? reqs : [],
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = ParamsSchema.safeParse({ id });
  if (!parsed.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const supabaseAuth = await createClient();
  if (!supabaseAuth) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceRoleClient();
  if (!service) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });

  const { data: posting, error: postingErr } = await service
    .from("job_postings")
    .select("id, description, title, company")
    .eq("id", id)
    .maybeSingle();

  if (postingErr) return NextResponse.json({ error: postingErr.message }, { status: 500 });
  if (!posting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { data: cached } = await service.from("job_summaries").select("*").eq("job_id", id).maybeSingle();
    if (cached) {
      const row = cached as { about_company: string | null; the_role: string | null; what_you_will_do: string[] | null; requirements: string[] | null };
      return NextResponse.json({
        about_company: row.about_company,
        the_role: row.the_role,
        what_you_will_do: row.what_you_will_do ?? [],
        requirements: row.requirements ?? [],
        cached: true,
      });
    }
  } catch {}

  const rawDescription = (posting as { description: string | null }).description ?? "";
  const description = stripHtml(rawDescription);
  const title = (posting as { title: string | null }).title ?? "";
  const company = (posting as { company: string | null }).company ?? "";

  let summary: SummaryShape | null = null;

  if (description.trim().length > 40) {
    try {
      const { generateText } = await import("ai");
      const { assertProviderConfig, createTextModel } = await import("@/lib/ai/provider");
      assertProviderConfig();
      const model = await createTextModel();
      const prompt = `Reformat this real job posting into readable sections. Use only information present in the provided text. Do not add company facts, role details, or requirements not explicitly stated. If a section has no relevant content omit it rather than inventing content.

Title: ${title}
Company: ${company}
Raw description:
${description.slice(0, 8000)}

Return JSON only with keys: about_company (string or null), the_role (string or null), what_you_will_do (string[] 0-6), requirements (string[] 0-6). Each bullet/requirement must be a sentence or phrase present or directly paraphrased from source, not invented.`;
      const result = await generateText({
        model,
        system: "You are reformatting a real job posting into readable sections. Use only information present in the provided text. Do not add company facts, role details, or requirements that are not explicitly stated in the source text. If a section has no relevant content in the source, omit that section rather than inventing content for it.",
        prompt,
        maxOutputTokens: 800,
      });
      const text = result?.text?.trim() ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsedJson = JSON.parse(match[0]) as Partial<SummaryShape>;
        const validated = z
          .object({
            about_company: z.string().nullable().optional(),
            the_role: z.string().nullable().optional(),
            what_you_will_do: z.array(z.string()).optional(),
            requirements: z.array(z.string()).optional(),
          })
          .safeParse(parsedJson);
        if (validated.success) {
          summary = {
            about_company: validated.data.about_company ?? null,
            the_role: validated.data.the_role ?? null,
            what_you_will_do: (validated.data.what_you_will_do ?? []).slice(0, 6),
            requirements: (validated.data.requirements ?? []).slice(0, 6),
          };
        }
      }
    } catch {
      // fall through to fallback
    }
  }

  if (!summary) summary = fallbackSummary(description);

  try {
    await service.from("job_summaries").insert({
      job_id: id,
      about_company: summary.about_company,
      the_role: summary.the_role,
      what_you_will_do: summary.what_you_will_do,
      requirements: summary.requirements,
    });
  } catch {}

  return NextResponse.json({ ...summary, cached: false });
}
