// FIX1c/d DRY-RUN — READ-ONLY. SELECTs only. No UPDATE/DELETE.
// Usage: set -a; source .env.local; set +a; node scripts/backfill-arbeitnow-dates.dryrun.mjs
// Reads SUPABASE_CONNECTION_URL? No — uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, serviceKey);

function suspicious(postedAt, ingestedAt) {
  if (!postedAt) return "posted_at NULL";
  const p = new Date(postedAt);
  if (isNaN(p.getTime())) return "posted_at unparseable";
  const year = p.getUTCFullYear();
  if (year < 2000 || year > new Date().getUTCFullYear() + 1) return `posted_at year out of range (${year})`;
  if (ingestedAt) {
    const gapDays = Math.abs(p.getTime() - new Date(ingestedAt).getTime()) / 86400000;
    if (gapDays > 365) return `posted_at >365d from ingested_at (${Math.round(gapDays)}d)`;
  }
  return null;
}

// 1. Arbeitnow postings sample
const { data: jobs, error: jobsErr } = await supabase
  .from("job_postings")
  .select("external_id, posted_at, ingested_at")
  .eq("source", "arbeitnow")
  .order("ingested_at", { ascending: false })
  .limit(50);
if (jobsErr) {
  console.error("job_postings SELECT failed:", jobsErr.message);
  process.exit(1);
}
console.log(`arbeitnow job_postings sampled: ${jobs.length} (latest 50)`);
let bad = 0;
for (const j of jobs) {
  const reason = suspicious(j.posted_at, j.ingested_at);
  if (reason) {
    bad++;
    console.log(`  SUSPICIOUS ${j.external_id} posted_at=${j.posted_at} ingested_at=${j.ingested_at} :: ${reason}`);
  }
}
console.log(`suspicious in sample: ${bad}/${jobs.length}`);

// 1b. Total arbeitnow count
const { count: totalArbeitnow } = await supabase
  .from("job_postings")
  .select("id", { count: "exact", head: true })
  .eq("source", "arbeitnow");
console.log(`total arbeitnow job_postings: ${totalArbeitnow}`);

// 2. skill_mentions month distribution for arbeitnow (month only, grouped client-side)
const { data: mentions, error: mErr } = await supabase.from("skill_mentions").select("month").eq("source", "arbeitnow").limit(20000);
if (mErr) {
  console.error("skill_mentions SELECT failed:", mErr.message);
} else {
  const byMonth = {};
  for (const m of mentions) byMonth[m.month] = (byMonth[m.month] ?? 0) + 1;
  console.log("skill_mentions month distribution (arbeitnow):", JSON.stringify(byMonth));
}

// 3. Snapshots at 1970-01 (all sources, then filtered)
const { data: snaps, error: sErr } = await supabase.from("skill_demand_snapshots").select("skill, month, source, mention_count").eq("month", "1970-01").limit(1000);
if (sErr) {
  console.error("skill_demand_snapshots SELECT failed:", sErr.message);
} else {
  const arb = snaps.filter((s) => s.source === "arbeitnow");
  console.log(`snapshots @1970-01: total=${snaps.length} arbeitnow=${arb.length}`);
  for (const s of arb.slice(0, 20)) console.log(`  ${s.skill} | ${s.source} | count=${s.mention_count}`);
}
