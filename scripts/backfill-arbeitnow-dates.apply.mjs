// FIX1c/d APPLY — approved backfill. Runs ONE step per invocation: node scripts/backfill-arbeitnow-dates.apply.mjs <step1|step2|step3>
// Each step asserts the expected affected-row count and exits non-zero on mismatch.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, serviceKey);
const step = process.argv[2];

if (step === "step1b") {
  // Per-row copy posted_at = ingested_at (Supabase JS has no column-to-column SET)
  const { data: rows, error: selErr } = await supabase
    .from("job_postings")
    .select("id, ingested_at")
    .eq("source", "arbeitnow")
    .gte("posted_at", "10000-01-01");
  if (selErr) {
    console.error("SELECT failed:", selErr.message);
    process.exit(1);
  }
  console.log(`step1: matched rows: ${rows.length} (expect 16)`);
  if (rows.length !== 16) {
    console.error("MISMATCH — stopping before any write");
    process.exit(1);
  }
  let updated = 0;
  for (const r of rows) {
    const { error: upErr } = await supabase.from("job_postings").update({ posted_at: r.ingested_at }).eq("id", r.id);
    if (upErr) {
      console.error(`UPDATE failed for ${r.id}:`, upErr.message);
      process.exit(1);
    }
    updated++;
  }
  const { data: verify } = await supabase
    .from("job_postings")
    .select("id")
    .eq("source", "arbeitnow")
    .gte("posted_at", "10000-01-01");
  console.log(`step1: updated=${updated}, remaining bad rows=${verify?.length ?? "?"}`);
  if ((verify?.length ?? -1) !== 0 || updated !== 16) {
    console.error("MISMATCH — verify failed");
    process.exit(1);
  }
  console.log("step1 OK");
}

if (step === "step2") {
  const { data, error } = await supabase
    .from("skill_mentions")
    .update({ month: "2026-09" })
    .eq("source", "arbeitnow")
    .eq("month", "1970-01")
    .select("job_id");
  if (error) {
    console.error("UPDATE failed:", error.message);
    process.exit(1);
  }
  console.log(`step2: updated rows: ${data?.length ?? "?"} (expect 29)`);
  if ((data?.length ?? -1) !== 29) {
    console.error("MISMATCH — count differs from 29, investigate before step3");
    process.exit(1);
  }
  const { data: verify } = await supabase.from("skill_mentions").select("job_id").eq("source", "arbeitnow").eq("month", "1970-01");
  console.log(`step2: remaining 1970-01 rows=${verify?.length ?? "?"}`);
  if ((verify?.length ?? -1) !== 0) {
    console.error("MISMATCH — leftovers remain");
    process.exit(1);
  }
  console.log("step2 OK");
}

if (step === "step3") {
  const { data: stale, error: selErr } = await supabase
    .from("skill_demand_snapshots")
    .select("skill, mention_count")
    .eq("month", "1970-01")
    .eq("source", "arbeitnow");
  if (selErr) {
    console.error("SELECT failed:", selErr.message);
    process.exit(1);
  }
  console.log(`step3: stale 1970-01 arbeitnow rows: ${stale.length} (expect 11)`);
  if (stale.length !== 11) {
    console.error("MISMATCH — stopping before merge");
    process.exit(1);
  }
  for (const s of stale) {
    const { data: existing } = await supabase
      .from("skill_demand_snapshots")
      .select("mention_count")
      .eq("skill", s.skill)
      .eq("month", "2026-09")
      .eq("source", "arbeitnow")
      .maybeSingle();
    if (existing) {
      const { error: upErr } = await supabase
        .from("skill_demand_snapshots")
        .update({ mention_count: existing.mention_count + s.mention_count })
        .eq("skill", s.skill)
        .eq("month", "2026-09")
        .eq("source", "arbeitnow");
      if (upErr) {
        console.error(`MERGE-UPDATE failed for ${s.skill}:`, upErr.message);
        process.exit(1);
      }
      console.log(`  merged ${s.skill}: +${s.mention_count} into 2026-09 (was ${existing.mention_count})`);
    } else {
      const { error: insErr } = await supabase
        .from("skill_demand_snapshots")
        .insert({ skill: s.skill, month: "2026-09", source: "arbeitnow", mention_count: s.mention_count });
      if (insErr) {
        console.error(`MERGE-INSERT failed for ${s.skill}:`, insErr.message);
        process.exit(1);
      }
      console.log(`  inserted ${s.skill} @2026-09 count=${s.mention_count} (no existing row)`);
    }
  }
  const { data: deleted, error: delErr } = await supabase
    .from("skill_demand_snapshots")
    .delete()
    .eq("month", "1970-01")
    .eq("source", "arbeitnow")
    .select("skill");
  if (delErr) {
    console.error("DELETE failed:", delErr.message);
    process.exit(1);
  }
  console.log(`step3: deleted rows: ${deleted?.length ?? "?"} (expect 11)`);
  if ((deleted?.length ?? -1) !== 11) {
    console.error("MISMATCH — deleted count differs");
    process.exit(1);
  }
  const { data: verify } = await supabase.from("skill_demand_snapshots").select("skill").eq("month", "1970-01").eq("source", "arbeitnow");
  console.log(`step3: remaining 1970-01 arbeitnow rows=${verify?.length ?? "?"}`);
  if ((verify?.length ?? -1) !== 0) {
    console.error("MISMATCH — leftovers remain");
    process.exit(1);
  }
  console.log("step3 OK");
}

if (!["step1b", "step2", "step3"].includes(step)) {
  console.error("Usage: node scripts/backfill-arbeitnow-dates.apply.mjs <step1b|step2|step3>");
  process.exit(1);
}
