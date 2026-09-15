"use client";

import { useRouter } from "next/navigation";
import { TopSkillsTable, type SkillRow } from "@/components/dashboard/TopSkillsTable";

export function DashboardTopSkills({ skills }: { skills: SkillRow[] }) {
  const router = useRouter();

  const handleSkillSelect = (skill: string) => {
    router.push(`/jobs?skill=${encodeURIComponent(skill)}`);
  };

  return <TopSkillsTable skills={skills} onSkillSelect={handleSkillSelect} />;
}
