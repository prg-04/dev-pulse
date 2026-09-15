// Deterministic matching formulas per AGENTS §13 — single source of truth
// Neither AI-generated nor approximated; pure arithmetic over Supabase rows.

export function marketAlignmentPct(
  userSkills: string[],
  top50: { skill: string; mention_count: number }[]
): number {
  if (top50.length === 0 || userSkills.length === 0) return 0;
  const userSet = new Set(userSkills.map((s) => s.toLowerCase()));
  let userSum = 0;
  let total = 0;
  for (const row of top50) {
    total += row.mention_count;
    if (userSet.has(row.skill.toLowerCase())) userSum += row.mention_count;
  }
  if (total === 0) return 0;
  return Math.round((userSum / total) * 100);
}

export function stackMatchPct(
  jobSkills: string[],
  userSkills: string[]
): number | undefined {
  if (!jobSkills || jobSkills.length === 0) return undefined; // "Not enough data" per §13a
  const userSet = new Set(userSkills.map((s) => s.toLowerCase()));
  const distinct = [...new Set(jobSkills.map((s) => s.toLowerCase()))];
  let matches = 0;
  for (const s of distinct) if (userSet.has(s)) matches++;
  return Math.round((matches / distinct.length) * 100);
}

export function computeRisingDeclining(
  history: Record<string, number>[], // ordered months oldest->newest, values per skill
  skillKeys: string[]
) {
  if (history.length < 2) return { rising: [] as { skill: string; delta: number }[], declining: [] as { skill: string; delta: number }[] };
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const deltas = skillKeys.map((k) => {
    const a = Number(last[k] ?? 0);
    const b = Number(prev[k] ?? 0);
    const delta = b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100);
    return { skill: k, delta };
  });
  const rising = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const declining = deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);
  return { rising, declining };
}
