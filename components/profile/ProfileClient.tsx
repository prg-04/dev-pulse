"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, Settings, Database, Layers, Radio, KeyRound, ShieldCheck, Zap, BarChart3, GraduationCap } from "lucide-react";
import { normalizeSkill } from "@/lib/skills-dictionary";

type InitialData = {
  profile: {
    full_name: string | null;
    email: string | null;
    location_text: string | null;
    timezone: string | null;
    github_username: string | null;
    auto_git_sync: boolean;
    target_role: string | null;
    target_tier: string | null;
    comp_floor: number | null;
    comp_ceiling: number | null;
    include_equity: boolean | null;
    contractor_pref: string | null;
    monitored_sources: string[];
  };
  skills: { skill: string; years: number | null; depth_tier: string | null; source: string }[];
  gapExpansion: string[];
  alertPrefs: {
    instant_match_alert: boolean;
    instant_match_threshold: number;
    weekly_digest: boolean;
    learning_gap_dispatch: boolean;
    delivery_method: "email" | "webhook";
  };
  apiKeyPrefix: string | null;
};

export function ProfileClient({ initialData }: { initialData: InitialData }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialData.profile);
  const [skills, setSkills] = useState(initialData.skills);
  const [gapExpansion] = useState(initialData.gapExpansion);
  const [alerts, setAlerts] = useState(initialData.alertPrefs);
  const [apiKeyPrefix] = useState(initialData.apiKeyPrefix);
  const [apiKeyRaw, setApiKeyRaw] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState("identity");
  const identityRef = useRef<HTMLElement>(null);
  const careerRef = useRef<HTMLElement>(null);
  const skillsRef = useRef<HTMLElement>(null);
  const sourcesRef = useRef<HTMLElement>(null);
  const alertsRef = useRef<HTMLElement>(null);
  const exportRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const sections = [
      { id: "identity", ref: identityRef },
      { id: "career", ref: careerRef },
      { id: "skills", ref: skillsRef },
      { id: "sources", ref: sourcesRef },
      { id: "alerts", ref: alertsRef },
      { id: "export", ref: exportRef },
    ] as const;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const first = visible[0].target as HTMLElement;
          const match = sections.find((s) => s.ref.current === first);
          if (match) setActivePanel(match.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );

    sections.forEach(({ ref }) => {
      if (ref.current) observer.observe(ref.current);
    });

    return () => observer.disconnect();
  }, []);

  function scrollToPanel(id: string) {
    const map: Record<string, React.RefObject<HTMLElement | null>> = {
      identity: identityRef,
      career: careerRef,
      skills: skillsRef,
      sources: sourcesRef,
      alerts: alertsRef,
      export: exportRef,
    };
    const ref = map[id];
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActivePanel(id);
  }

  // local editable copies
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [github, setGithub] = useState(profile.github_username ?? "");
  const [locationText, setLocationText] = useState(profile.location_text ?? "");
  const [autoSync, setAutoSync] = useState(profile.auto_git_sync);
  const [targetRole, setTargetRole] = useState(profile.target_role ?? "");
  const [targetTier, setTargetTier] = useState(profile.target_tier ?? "");
  const [compFloor, setCompFloor] = useState(String(profile.comp_floor ?? 160000));
  const [compCeiling, setCompCeiling] = useState(String(profile.comp_ceiling ?? 220000));
  const [includeEquity, setIncludeEquity] = useState(!!profile.include_equity);
  const [contractorPref, setContractorPref] = useState(profile.contractor_pref ?? "W8-BEN");
  const [newSkill, setNewSkill] = useState("");
  const [newSkillYears, setNewSkillYears] = useState("");
  const [newSkillTier, setNewSkillTier] = useState("");
  const [skillError, setSkillError] = useState<string | null>(null);

  function toggleSource(src: string) {
    setProfile((p) => ({
      ...p,
      monitored_sources: p.monitored_sources.includes(src) ? p.monitored_sources.filter((s) => s !== src) : [...p.monitored_sources, src],
    }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          location_text: locationText,
          github_username: github || null,
          auto_git_sync: autoSync,
          target_role: targetRole || null,
          target_tier: targetTier || null,
          comp_floor: compFloor ? Number(compFloor) : null,
          comp_ceiling: compCeiling ? Number(compCeiling) : null,
          include_equity: includeEquity,
          contractor_pref: contractorPref,
          monitored_sources: profile.monitored_sources,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j.error ? (typeof j.error === "string" ? j.error : JSON.stringify(j.error)) : `Save failed (${res.status})`;
        throw new Error(msg);
      }
      const json = await res.json();
      if (json.profile) setProfile((p) => ({ ...p, ...json.profile }));
      window.dispatchEvent(new CustomEvent("devpulse:profile-updated"));

      const aRes = await fetch("/api/alert-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alerts),
      });
      if (!aRes.ok) {
        const j = await aRes.json().catch(() => ({}));
        const msg = j.error ? (typeof j.error === "string" ? j.error : JSON.stringify(j.error)) : `Alert preferences save failed (${aRes.status})`;
        throw new Error(msg);
      }

      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSkill() {
    setSkillError(null);
    const canonical = normalizeSkill(newSkill);
    if (!canonical) {
      setSkillError("Unknown skill — not in dictionary");
      return;
    }
    const res = await fetch("/api/profile/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skill: canonical,
        years: newSkillYears ? Number(newSkillYears) : null,
        depth_tier: newSkillTier || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const msg = j.error ? (typeof j.error === "string" ? j.error : JSON.stringify(j.error)) : "Failed to add skill";
      setSkillError(msg);
      return;
    }
    const j = await res.json().catch(() => ({}));
    const saved = j.skill as { skill: string; years: number | null; depth_tier: string | null; source: string } | undefined;
    if (saved) {
      setSkills((prev) => {
        const exists = prev.find((p) => p.skill === saved.skill);
        if (exists) return prev.map((p) => (p.skill === saved.skill ? saved : p));
        return [...prev, saved];
      });
    } else {
      router.refresh();
    }
    setNewSkill("");
    setNewSkillYears("");
    setNewSkillTier("");
    router.refresh();
  }

  async function handleRemoveSkill(skill: string) {
    setSkillError(null);
    const res = await fetch(`/api/profile/skills?skill=${encodeURIComponent(skill)}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const msg = j.error ? (typeof j.error === "string" ? j.error : JSON.stringify(j.error)) : "Failed to remove skill";
      setSkillError(msg);
      return;
    }
    setSkills((prev) => prev.filter((s) => s.skill !== skill));
    router.refresh();
  }

  async function handleRegenerateKey() {
    // Revoke old key first
    await fetch("/api/keys/revoke", { method: "POST" });
    const res = await fetch("/api/keys", { method: "POST" });
    if (res.ok) {
      const j = await res.json();
      setApiKeyRaw(j.raw);
    }
  }

  const handleCopyKey = useCallback(async () => {
    if (apiKeyRaw) {
      await navigator.clipboard.writeText(apiKeyRaw);
      return;
    }
    const res = await fetch("/api/keys", { method: "POST" });
    if (res.ok) {
      const j = await res.json();
      setApiKeyRaw(j.raw);
      await navigator.clipboard.writeText(j.raw);
    }
  }, [apiKeyRaw]);

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-[#475569]">CONFIG / TERMINAL_PREFERENCES #NODE-5821</div>
          <h1 className="mt-1 font-[var(--font-heading)] text-[28px] font-bold tracking-tight text-white leading-none">Profile &amp; Market Preferences</h1>
          <p className="mt-1.5 max-w-[640px] text-xs leading-relaxed text-[#94A3B8]">
             Manage your profile delta, calibration baselines, active crawling feeds, and automated intelligence dispatch alerts.
           </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-[#1E293B] bg-[#0F172A] px-3 py-2">
          <div className="text-right">
            <div className="text-[10px] tracking-widest text-[#64748B]">CALIBRATION INDEX</div>
            <div className="text-xs font-semibold text-[#2DD4BF]">94.2% OPTIMAL</div>
          </div>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#14B8A6]/15 ring-1 ring-[#14B8A6]/30">
            <ShieldCheck className="h-3.5 w-3.5 text-[#2DD4BF]" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-12 gap-6">
        {/* Left rail */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-4">
            <div className="text-[10px] font-semibold tracking-widest text-[#475569]">PREFERENCE_PANELS</div>
              <nav className="mt-3 space-y-1">
                {[
                  { id: "identity", icon: Settings, label: "Identity & Account", meta: "•" },
                  { id: "career", icon: BarChart3, label: "Career & Comp", meta: `$${Math.round((profile.comp_ceiling ?? 220000) / 1000)}k` },
                  { id: "skills", icon: Layers, label: "Skill Baseline", meta: `${skills.length} stack` },
                  { id: "sources", icon: Database, label: "Monitored Sources", meta: `${profile.monitored_sources.length}/10 live` },
                  { id: "alerts", icon: Radio, label: "Alerts & Dispatch", meta: "3 active" },
                  { id: "export", icon: KeyRound, label: "API & Data Export", meta: apiKeyPrefix ? "v2.4" : "v2.4" },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => scrollToPanel(item.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs text-left ${activePanel === item.id ? "bg-[#14B8A6]/10 text-[#2DD4BF] ring-1 ring-[#14B8A6]/20" : "text-[#94A3B8] hover:bg-white/[0.04]"}`}
                  >
                    <span className="flex items-center gap-2">
                      <item.icon className="h-3.5 w-3.5" /> {item.label}
                    </span>
                    <span className={`text-[10px] ${activePanel === item.id ? "text-[#2DD4BF]" : "text-[#475569]"}`}>{item.meta}</span>
                  </button>
                ))}
              </nav>
          </div>

          <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-4">
            <div className="flex items-center justify-between text-[10px] font-semibold tracking-widest">
              <span className="text-[#475569]">CRAWLER HEARTBEAT</span>
              <span className="flex items-center gap-1 text-[#22C55E]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" /> ACTIVE
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
               Last job sweep indexed <span className="text-white">28,555</span> listings. Profile vector embeddings refresh hourly.
             </p>
             <div className="mt-3 h-1.5 w-full rounded-full bg-[#1E293B]">
               <div className="h-1.5 w-[92%] rounded-full bg-[#14B8A6]" />
             </div>
           </div>
         </aside>

         {/* Main stack */}
         <div className="col-span-12 lg:col-span-9 space-y-4">
            {/* 1 Identity & Terminal Handle */}
            <section id="panel-identity" ref={identityRef} className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
             <div className="flex items-start justify-between gap-4">
               <div className="flex items-center gap-2">
                 <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#14B8A6]/15">
                   <Activity className="h-3.5 w-3.5 text-[#2DD4BF]" />
                 </div>
                 <div>
                   <h2 className="text-sm font-semibold text-white">Identity &amp; Terminal Handle</h2>
                   <p className="text-[11px] text-[#64748B]">Authentication, geographic parameters, and external developer links.</p>
                 </div>
               </div>
               <span className="hidden rounded bg-[#0B1220] px-2 py-1 text-[10px] font-mono text-[#2DD4BF] ring-1 ring-[#1E293B] md:block">ID: USR-4291A</span>
             </div>

             <div className="mt-4 grid grid-cols-12 gap-4">
               <div className="col-span-12 md:col-span-4 rounded-lg border border-[#1E293B] bg-[#070A14] p-4 text-center">
                 <div className="mx-auto h-16 w-16 rounded-md bg-[#1E293B] ring-1 ring-white/10 overflow-hidden flex items-center justify-center text-[#64748B]">◈</div>
                 <div className="mt-2 text-xs font-medium text-[#2DD4BF]">@{(github || "alex.dev").replace(/^@/, "")}</div>
                 <div className="text-[11px] text-[#64748B]">Staff / Lead Engineer</div>
                 <div className="mx-auto mt-2 inline-flex rounded bg-[#14B8A6]/10 px-2 py-1 text-[10px] font-medium text-[#2DD4BF] ring-1 ring-[#14B8A6]/20">Remote Ready</div>
               </div>
               <div className="col-span-12 md:col-span-8 grid grid-cols-1 gap-3 md:grid-cols-2">
                 <label className="space-y-1">
                   <span className="text-[10px] tracking-widest text-[#475569]">FULL NAME</span>
                   <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-md border border-[#1E293B] bg-[#070A14] px-2.5 py-2 text-sm text-white placeholder:text-[#475569] focus:border-[#14B8A6]/50 focus:outline-none" placeholder="Alex Rivera" />
                 </label>
                 <label className="space-y-1">
                   <span className="text-[10px] tracking-widest text-[#475569]">PRIMARY EMAIL</span>
                   <input value={profile.email ?? ""} readOnly className="w-full rounded-md border border-[#1E293B] bg-[#0B1220] px-2.5 py-2 text-sm text-[#94A3B8]" />
                 </label>
                 <label className="space-y-1 md:col-span-2">
                   <span className="text-[10px] tracking-widest text-[#475569]">BASE LOCATION &amp; TARGET ZONE DELTA</span>
                   <div className="flex gap-2">
                     <input value={locationText} onChange={(e) => setLocationText(e.target.value)} className="flex-1 rounded-md border border-[#1E293B] bg-[#070A14] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none" placeholder="Nairobi, Kenya (UTC+3)" />
                     <span className="hidden items-center rounded bg-[#22C55E]/10 px-2 text-[11px] font-medium text-[#86EFAC] ring-1 ring-[#22C55E]/20 md:inline-flex">Targeting US Remote (UTC+4 to UTC-8)</span>
                   </div>
                 </label>
                 <label className="space-y-1 md:col-span-2">
                   <span className="text-[10px] tracking-widest text-[#475569]">CODE REPOSITORY AUTHORITY</span>
                   <div className="flex gap-2">
                     <input value={github} onChange={(e) => setGithub(e.target.value)} className="flex-1 rounded-md border border-[#1E293B] bg-[#070A14] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none" placeholder="github.com/alexrivera" />
                     <span className="hidden items-center gap-1 rounded bg-[#22C55E]/10 px-2 text-[11px] font-medium text-[#86EFAC] ring-1 ring-[#22C55E]/20 md:inline-flex">
                       <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> Verified Sync
                     </span>
                   </div>
                   <span className="text-[11px] text-[#475569]">Next sync: Sunday 04:00 UTC</span>
                 </label>
               </div>
             </div>
           </section>

            {/* 2 Career Target */}
            <section id="panel-career" ref={careerRef} className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#F59E0B]/15">
                   <BarChart3 className="h-3.5 w-3.5 text-[#F59E0B]" />
                 </div>
                 <div>
                   <h2 className="text-sm font-semibold text-white">Career Target &amp; Compensation Filter</h2>
                   <p className="text-[11px] text-[#64748B]">Strict qualification boundaries used to discard low-signal job matches.</p>
                 </div>
               </div>
               <span className="rounded bg-[#1E293B] px-2 py-1 text-[10px] tracking-widest text-[#94A3B8]">CALIBRATED</span>
             </div>

             <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
               <label className="space-y-1">
                 <span className="text-[10px] tracking-widest text-[#475569]">TARGET ROLE ARCHETYPE</span>
                 <input value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="w-full rounded-md border border-[#1E293B] bg-[#070A14] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none" />
                 <span className="text-[11px] text-[#475569]">Cross-references postings matching: Backend, Systems, High-Concurrency Node/Go</span>
               </label>
               <label className="space-y-1">
                 <span className="text-[10px] tracking-widest text-[#475569]">LIQUIDITY &amp; COMPANY MATURITY TIER</span>
                 <input value={targetTier} onChange={(e) => setTargetTier(e.target.value)} className="w-full rounded-md border border-[#1E293B] bg-[#070A14] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none" />
                 <span className="text-[11px] text-[#475569]">Filters out non-funded early stage entities without verifiable runway.</span>
               </label>
               <div className="space-y-1">
                 <span className="text-[10px] tracking-widest text-[#475569]">DESIRED BASE COMPENSATION FLOOR (USD)</span>
                 <div className="flex gap-2">
                   <input value={compFloor} onChange={(e) => setCompFloor(e.target.value)} className="w-full rounded-md border border-[#1E293B] bg-[#070A14] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none" />
                   <span className="hidden items-center text-[#475569] md:inline-flex">—</span>
                   <input value={compCeiling} onChange={(e) => setCompCeiling(e.target.value)} className="w-full rounded-md border border-[#1E293B] bg-[#070A14] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none" />
                 </div>
                 <div className="flex items-center gap-2 text-[11px]">
                   <span className="font-mono text-white">$160,000 – $220,000</span>
                   <span className="text-[#475569]">/ YEAR</span>
                 </div>
                 <span className="text-[11px] text-[#22C55E]">● 87th percentile for remote full-stack candidates in global indices</span>
               </div>
               <div className="space-y-3">
                 <label className="flex items-center justify-between rounded-md border border-[#1E293B] bg-[#070A14] px-3 py-2">
                   <span className="text-xs text-white">Include Equity &amp; Options in Evaluation</span>
                   <input type="checkbox" checked={includeEquity} onChange={(e) => setIncludeEquity(e.target.checked)} className="h-4 w-4 accent-[#14B8A6]" />
                 </label>
                 <div className="flex items-center justify-between text-[11px]">
                   <span className={`rounded px-2 py-1 ring-1 ${contractorPref === "W8-BEN" ? "bg-[#14B8A6]/15 text-[#2DD4BF] ring-[#14B8A6]/30" : "bg-[#1E293B] text-[#94A3B8]"}`}>
                     <button type="button" onClick={() => setContractorPref("W8-BEN")}>W8-BEN Contractor</button>
                   </span>
                   <span className="text-[#475569]">or</span>
                   <span className={`rounded px-2 py-1 ring-1 ${contractorPref !== "W8-BEN" ? "bg-[#14B8A6]/15 text-[#2DD4BF] ring-[#14B8A6]/30" : "bg-[#1E293B] text-[#94A3B8]"}`}>
                     <button type="button" onClick={() => setContractorPref("Deel / Remote EOR")}>Deel / Remote EOR</button>
                   </span>
                 </div>
               </div>
             </div>
           </section>

            {/* 3 Core Skill Stack */}
            <section id="panel-skills" ref={skillsRef} className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#14B8A6]/15">
                   <Layers className="h-3.5 w-3.5 text-[#2DD4BF]" />
                 </div>
                 <div>
                   <h2 className="text-sm font-semibold text-white">Core Skill Stack &amp; Git Delta Engine</h2>
                   <p className="text-[11px] text-[#64748B]">Direct telemetry baseline used by the Gap Report algorithm.</p>
                 </div>
               </div>
               <button type="button" onClick={() => document.getElementById("add-skill-input")?.focus()} className="text-[11px] font-medium text-[#2DD4BF] hover:text-white">+ Add Skill Vector</button>
             </div>

             <div className="mt-4 space-y-3">
               <div className="text-[10px] tracking-widest text-[#475569]">ACTIVE PRODUCTION WEIGHTS (YEARS &amp; DEPTH TIER)</div>
               <div className="flex flex-wrap gap-1.5">
                 {skills.map((s) => (
                   <span
                     key={s.skill}
                     className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ${s.source === "github_sync" ? "bg-transparent text-[#94A3B8] ring-[#334155] border-dashed" : "bg-[#1E293B] text-[#2DD4BF] ring-[#1E293B]"}`}
                     title={s.source}
                   >
                     {s.skill} <span className="text-[10px] text-[#64748B]">{s.years ? `${s.years}y` : ""} {s.depth_tier ? `· ${s.depth_tier}` : ""}</span>
                     {s.source === "manual" && (
                       <button type="button" onClick={() => handleRemoveSkill(s.skill)} className="ml-1 text-[10px] text-[#475569] hover:text-white">×</button>
                     )}
                   </span>
                 ))}
               </div>

               <div className="flex flex-col gap-2 rounded-lg border border-[#1E293B] bg-[#070A14] p-3 md:flex-row md:items-end">
                 <div className="flex-1 space-y-1">
                   <span className="text-[10px] tracking-widest text-[#475569]">ADD SKILL</span>
                   <input
                     id="add-skill-input"
                     value={newSkill}
                     onChange={(e) => { setNewSkill(e.target.value); setSkillError(null); }}
                     className="w-full rounded-md border border-[#1E293B] bg-[#0F172A] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none"
                     placeholder="e.g. typescript"
                   />
                   {skillError && <span className="text-[11px] text-[#EF4444]">{skillError}</span>}
                 </div>
                 <div className="flex gap-2">
                   <input value={newSkillYears} onChange={(e) => setNewSkillYears(e.target.value)} className="w-20 rounded-md border border-[#1E293B] bg-[#0F172A] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none" placeholder="Years" />
                   <select value={newSkillTier} onChange={(e) => setNewSkillTier(e.target.value)} className="rounded-md border border-[#1E293B] bg-[#0F172A] px-2.5 py-2 text-sm text-white focus:border-[#14B8A6]/50 focus:outline-none">
                     <option value="">Tier</option>
                     <option value="core">Core</option>
                     <option value="familiar">Familiar</option>
                     <option value="learning">Learning</option>
                   </select>
                   <button type="button" onClick={handleAddSkill} className="rounded-md bg-[#14B8A6] px-3 py-2 text-xs font-medium text-black hover:bg-[#2DD4BF]">Add</button>
                 </div>
               </div>

               <div className="rounded-lg border border-[#1E293B] bg-[#070A14] p-3">
                 <div className="flex items-center justify-between">
                   <span className="text-[10px] tracking-widest text-[#475569]">ACTIVE GAP EXPANSION (IN-PROGRESS LEARNING)</span>
                   <label className="flex items-center gap-2 text-xs text-white">
                     Auto-Git Sync
                     <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} className="h-4 w-8 accent-[#14B8A6]" />
                   </label>
                 </div>
                 <div className="mt-2 flex flex-wrap gap-1.5">
                   {gapExpansion.map((g) => (
                     <span key={g} className="inline-flex items-center gap-1 rounded-full bg-[#F59E0B]/15 px-2.5 py-1 text-xs text-[#F59E0B] ring-1 ring-[#F59E0B]/20">
                       <span className="h-1 w-1 rounded-full bg-[#F59E0B]" /> {g}
                     </span>
                   ))}
                   {gapExpansion.length === 0 && <span className="text-xs text-[#475569]">No active gaps — run a Gap Report to populate.</span>}
                 </div>
                 <div className="mt-2 text-[11px] text-[#475569]">Indexed for prioritized curriculum matching · Weekly repo tag scans</div>
               </div>
             </div>
           </section>

            {/* 4 Ingestion Sources */}
            <section id="panel-sources" ref={sourcesRef} className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#22C55E]/15">
                   <Database className="h-3.5 w-3.5 text-[#22C55E]" />
                 </div>
                 <div>
                   <h2 className="text-sm font-semibold text-white">Ingestion Sources &amp; Crawlers</h2>
                   <p className="text-[11px] text-[#64748B]">Continuous market listening nodes active in your search space.</p>
                 </div>
               </div>
               <span className="hidden items-center gap-1 rounded bg-[#22C55E]/10 px-2 py-1 text-[10px] font-medium text-[#22C55E] ring-1 ring-[#22C55E]/20 md:inline-flex">
                 <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> ALL PIPELINES HEALTHY
               </span>
             </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {[
                  { name: "HackerNews 'Who is Hiring'", count: "1,249 monthly postings", note: "Structured extraction · monthly sync", key: "hackernews" },
                  { name: "Himalayas Remote API", count: "7,491 monthly postings", note: "High engineering density · 6h polling", key: "himalayas" },
                  { name: "RemoteJobs.com US Vector", count: "3,205 monthly postings", note: "Salary disclosure 1 filtered · daily sync", key: "remotejobs" },
                  { name: "Remotive Remote Feed", count: "3,611 monthly postings", note: "Global contract eligible · 12h sweep", key: "remotive" },
                  { name: "Arbeitnow ATS Feed", count: "~2k monthly postings", note: "EU-leaning ATS · remote filter · daily", key: "arbeitnow" },
                  { name: "RemoteOK Developer Board", count: "~5k monthly postings", note: "High-volume dev board · tags extraction", key: "remoteok" },
                  { name: "Jobicy Engineering", count: "~3k monthly postings", note: "IT/tech-leaning · industry=engineering", key: "jobicy" },
                  { name: "Adzuna Aggregator (keyed)", count: "Broad aggregator · /10 quota", note: "Requires ADZUNA_APP_ID/KEY · 20 countries", key: "adzuna" },
                  { name: "Jooble Aggregator (keyed, POST)", count: "67-country coverage", note: "Key in URL path — never logged", key: "jooble" },
                  { name: "The Muse Curated (optional key)", count: "Curated employer-posted", note: "500/hr keyless · 3600/hr keyed", key: "themuse" },
                ].map((src) => (
                 <div key={src.key} className="rounded-lg border border-[#1E293B] bg-[#070A14] p-3">
                   <div className="flex items-start justify-between gap-2">
                     <div>
                       <div className="text-xs font-medium text-white">{src.name}</div>
                       <div className="text-[11px] text-[#2DD4BF]">{src.count}</div>
                       <div className="text-[11px] text-[#475569]">{src.note}</div>
                     </div>
                     <label className="inline-flex">
                        <input type="checkbox" checked={profile.monitored_sources.includes(src.key)} onChange={() => toggleSource(src.key)} className="h-4 w-8 accent-[#14B8A6]" />
                     </label>
                   </div>
                 </div>
               ))}
             </div>

             <div className="mt-3 flex items-center justify-between border-t border-[#1E293B] pt-3">
               <span className="text-[10px] tracking-widest text-[#475569]">INGESTION CADENCE SCHEDULE</span>
               <span className="inline-flex items-center gap-1 rounded bg-[#0B1220] px-2 py-1 text-[11px] text-[#94A3B8] ring-1 ring-[#1E293B]">
                 <span className="h-2 w-2 rounded-full border border-[#2DD4BF]" /> Daily at 06:00 UTC (Recommended)
               </span>
             </div>
           </section>

            {/* 5 Dispatch & Alerts */}
            <section id="panel-alerts" ref={alertsRef} className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#8B5CF6]/15">
                   <Radio className="h-3.5 w-3.5 text-[#8B5CF6]" />
                 </div>
                 <div>
                   <h2 className="text-sm font-semibold text-white">Market Intelligence Dispatch &amp; Alerts</h2>
                   <p className="text-[11px] text-[#64748B]">Automated triggers sent directly to your verified inbox.</p>
                 </div>
               </div>
               <span className="text-[10px] tracking-widest text-[#64748B]">WEBHOOK / EMAIL</span>
             </div>

             <div className="mt-4 space-y-3">
               {[
                 {
                   title: "Instant Alert on High-Affinity Match",
                   desc: `Notify via email when a posting matches ≥${alerts.instant_match_threshold}% of your active skill profile and clears compensation bounds.`,
                   key: "instant_match_alert" as const,
                 },
                 {
                   title: "Weekly Market Delta Digest",
                   desc: "A high-signal Monday morning briefing detailing the fastest rising and declining skills in your role tier.",
                   key: "weekly_digest" as const,
                 },
                 {
                   title: "Curated Learning Gap Dispatch",
                   desc: "Automatic recommendations when top-tier guides or docs are indexed for your flagged gaps (e.g. AWS, Kubernetes).",
                   key: "learning_gap_dispatch" as const,
                 },
               ].map((item) => (
                 <label key={item.key} className="flex items-start justify-between gap-3 rounded-lg border border-[#1E293B] bg-[#070A14] p-3">
                   <div className="flex gap-2">
                     <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#1E293B]">
                       {item.key === "instant_match_alert" ? <Zap className="h-3.5 w-3.5 text-[#2DD4BF]" /> : item.key === "weekly_digest" ? <BarChart3 className="h-3.5 w-3.5 text-[#F59E0B]" /> : <GraduationCap className="h-3.5 w-3.5 text-[#86EFAC]" />}
                     </div>
                     <div>
                       <div className="text-sm font-medium text-white">{item.title}</div>
                       <div className="text-[11px] leading-relaxed text-[#64748B]">{item.desc}</div>
                     </div>
                   </div>
                   <input
                     type="checkbox"
                     checked={alerts[item.key]}
                     onChange={(e) => setAlerts((a) => ({ ...a, [item.key]: e.target.checked }))}
                     className="h-4 w-8 accent-[#14B8A6]"
                   />
                 </label>
               ))}
             </div>
           </section>

            {/* 6 Readout Key & Export */}
            <section id="panel-export" ref={exportRef} className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
             <div className="flex items-center gap-2">
               <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1E293B]">
                 <KeyRound className="h-3.5 w-3.5 text-[#94A3B8]" />
               </div>
               <div>
                 <h2 className="text-sm font-semibold text-white">DevPulse Readout Key &amp; JSON Export</h2>
                 <p className="text-[11px] text-[#64748B]">Query your own profile delta vectors programmatically.</p>
               </div>
             </div>
             <div className="mt-4 rounded-lg border border-[#1E293B] bg-[#070A14] p-3">
               <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                 <div className="flex-1">
                   <div className="text-[10px] tracking-widest text-[#475569]">BEARER TOKEN (READ-ONLY)</div>
                   <div className="mt-1 flex items-center gap-2">
                     <input
                       readOnly
                       value={apiKeyRaw ?? (apiKeyPrefix ? `${apiKeyPrefix}••••` : "generate to view")}
                       className="w-full rounded-md border border-[#1E293B] bg-[#0B1220] px-2.5 py-2 text-xs text-[#94A3B8] focus:outline-none"
                     />
                     <button
                       type="button"
                       onClick={handleCopyKey}
                       className="shrink-0 rounded-md bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#334155]"
                     >
                       Copy Key
                     </button>
                   </div>
                   {apiKeyRaw && (
                     <p className="mt-1 text-[11px] text-[#22C55E]">Full key shown plaintext exactly once — copy it now. Regenerate invalidates previous key.</p>
                   )}
                 </div>
                 <div className="flex gap-2">
                   <button
                     type="button"
                     onClick={handleRegenerateKey}
                     className="rounded-md bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#334155]"
                   >
                     Regenerate
                   </button>
                   <a href="/api/export" target="_blank" className="rounded-md bg-[#14B8A6] px-3 py-1.5 text-xs font-medium text-black hover:bg-[#2DD4BF]">Export JSON</a>
                 </div>
               </div>
             </div>
           </section>

            {saveError && (
              <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">{saveError}</div>
            )}
            <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-[#1E293B] bg-[#0F172A] p-4 md:flex-row">
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
                <span className="text-white">Ready to commit updates</span>
                <span className="text-[#475569]">Last saved: {savedAt ?? "14m ago"} · DevPulse Engine Synced</span>
              </div>
              <div className="flex gap-2">
                <button type="button" className="rounded-md px-3 py-2 text-xs text-[#94A3B8] hover:text-white">Discard</button>
                <button type="button" onClick={handleSave} disabled={saving} className="rounded-md bg-[#14B8A6] px-4 py-2 text-xs font-medium text-black hover:bg-[#2DD4BF] disabled:opacity-60">
                  {saving ? "Saving..." : "Save Preferences"}
                </button>
              </div>
            </div>
         </div>
       </div>
     </main>
   );
 }
