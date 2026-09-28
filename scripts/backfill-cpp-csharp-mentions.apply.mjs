// Backfill c++/c# skill_mentions + skill_demand_snapshots — APPROVED apply.
// The fixed extractSkills boundary (trailing-\b drop for non-word-ending
// aliases) recovered 43 c++ and 37 c# postings whose mentions were never
// written. This script inserts exactly the dry-run set, then upserts
// snapshots with the same read-modify-write logic as ingest step 8.
// Aborts before ANY write unless the recomputed diff matches the dry run
// (80 inserts: 43 c++, 37 c#).
// Usage: set -a; source .env.local; set +a; node scripts/backfill-cpp-csharp-mentions.apply.mjs
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, serviceKey);
const BATCH_SIZE = 100;

// --- Verbatim copies of production logic (ingest route + lib/sanitize) ---
function stripHtml(value) {
  if (!value) return "";
  let text = value;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|section|article|header|footer)>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&#x27;/gi, "'");
  text = text.replace(/&#x2F;/gi, "/");
  text = text.replace(/&#(\d+);/g, (_, n) => {
    const code = Number.parseInt(n, 10);
    return Number.isNaN(code) ? "" : String.fromCharCode(code);
  });
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
    const code = Number.parseInt(h, 16);
    return Number.isNaN(code) ? "" : String.fromCharCode(code);
  });
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]*/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function deriveMonth(dateStr) {
  if (!dateStr) {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const TARGETS = [
  { canonical: "c++", aliases: ["c++", "cpp"] },
  { canonical: "c#", aliases: ["c#"] },
];

function extractFixed(text) {
  const lower = text.toLowerCase();
  const found = new Set();
  for (const entry of TARGETS) {
    for (const alias of entry.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const end = /\w$/.test(alias) ? "\\b" : "";
      if (new RegExp(`\\b${escaped}${end}`, "i").test(lower)) {
        found.add(entry.canonical);
        break;
      }
    }
  }
  return [...found];
}

async function getAllMentions() {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("skill_mentions")
      .select("job_id, skill")
      .in("skill", ["c++", "c#"])
      .order("job_id")
      .range(offset, offset + 999);
    if (error) {
      console.error("skill_mentions SELECT failed:", error.message);
      process.exit(1);
    }
    if (data.length === 0) break;
    out.push(...data);
    offset += data.length;
  }
  return out;
}

// --- Step 1: recompute diff, gate on dry-run counts ---
const jobs = [];
{
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("job_postings")
      .select("id, source, posted_at, title, description")
      .order("id")
      .range(offset, offset + 999);
    if (error) {
      console.error("job_postings SELECT failed:", error.message);
      process.exit(1);
    }
    if (data.length === 0) break;
    jobs.push(...data);
    offset += data.length;
  }
}
const existing = await getAllMentions();
const have = new Set(existing.map((r) => `${r.job_id}|${r.skill}`));
const inserts = [];
for (const j of jobs) {
  for (const s of extractFixed(`${j.title ?? ""}\n${stripHtml(j.description)}`)) {
    if (!have.has(`${j.id}|${s}`)) {
      inserts.push({ job_id: j.id, skill: s, month: deriveMonth(j.posted_at), source: j.source });
    }
  }
}
const bySkill = {};
for (const i of inserts) bySkill[i.skill] = (bySkill[i.skill] ?? 0) + 1;
console.log(`diff: ${inserts.length} inserts (c++: ${bySkill["c++"] ?? 0}, c#: ${bySkill["c#"] ?? 0}) — expect 80 (43/37)`);
if (inserts.length !== 80 || bySkill["c++"] !== 43 || bySkill["c#"] !== 37) {
  console.error("MISMATCH vs dry run — stopping before any write");
  process.exit(1);
}

// --- Step 2: batched mentions inserts (ingest step 7 pattern) ---
for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
  const batch = inserts.slice(i, i + BATCH_SIZE);
  const { error } = await supabase.from("skill_mentions").insert(batch);
  if (error) {
    console.error(`skill_mentions insert failed at ${i}:`, error.message);
    process.exit(1);
  }
  console.log(`skill_mentions batch ok: ${batch.length}`);
}

// --- Step 3: snapshot read-modify-write upsert (ingest step 8 pattern) ---
const snapshotCounts = new Map();
for (const i of inserts) {
  const key = `${i.skill}|${i.month}|${i.source}`;
  snapshotCounts.set(key, (snapshotCounts.get(key) ?? 0) + 1);
}
const months = [...new Set([...snapshotCounts.keys()].map((k) => k.split("|")[1]))];
const sources = [...new Set([...snapshotCounts.keys()].map((k) => k.split("|")[2]))];
const { data: existingSnapshots, error: snapSelErr } = await supabase
  .from("skill_demand_snapshots")
  .select("skill, mention_count, month, source")
  .in("month", months)
  .in("source", sources);
if (snapSelErr) {
  console.error("snapshot SELECT failed:", snapSelErr.message);
  process.exit(1);
}
const existingMap = new Map();
for (const s of existingSnapshots ?? []) {
  existingMap.set(`${s.skill}|${s.month}|${s.source}`, s.mention_count);
}
const snapshotRows = [...snapshotCounts.entries()].map(([key, count]) => {
  const [skill, month, source] = key.split("|");
  return { skill, month, source, mention_count: (existingMap.get(key) ?? 0) + count };
});
for (let i = 0; i < snapshotRows.length; i += BATCH_SIZE) {
  const batch = snapshotRows.slice(i, i + BATCH_SIZE);
  const { error } = await supabase
    .from("skill_demand_snapshots")
    .upsert(batch, { onConflict: "skill,month,source" });
  if (error) {
    console.error(`snapshot upsert failed at ${i}:`, error.message);
    process.exit(1);
  }
  console.log(`snapshot batch ok: ${batch.length}`);
}

console.log(`done: ${inserts.length} mentions, ${snapshotRows.length} snapshot rows`);
