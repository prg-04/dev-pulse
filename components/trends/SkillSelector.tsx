"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ALL_SKILLS, normalizeSkill } from "@/lib/skills-dictionary";

type Props = {
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
};

export function SkillSelector({ selected, onChange, max = 5 }: Props) {
  const [input, setInput] = useState("");
  const [ suggestions, setSuggestions] = useState<string[]>([]);

  const handleInput = (val: string) => {
    setInput(val);
    if (!val.trim()) {
      setSuggestions([]);
      return;
    }
    const lower = val.toLowerCase();
    const filtered = ALL_SKILLS.filter((s) => s.includes(lower) && !selected.includes(s)).slice(0, 6);
    setSuggestions(filtered);
  };

  const addSkill = (raw: string) => {
    const normalized = normalizeSkill(raw) ?? raw.toLowerCase().trim();
    if (!normalized) return;
    if (selected.includes(normalized)) {
      setInput("");
      setSuggestions([]);
      return;
    }
    if (selected.length >= max) return;
    if (!ALL_SKILLS.includes(normalized)) return;
    onChange([...selected, normalized]);
    setInput("");
    setSuggestions([]);
  };

  const removeSkill = (skill: string) => {
    onChange(selected.filter((s) => s !== skill));
  };

  return (
    <div className="relative flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#1E293B] bg-[#0F172A]/60 px-3 py-2.5">
        {selected.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#14B8A6]/30 bg-[#0B1220] px-2 py-1 text-xs font-medium text-[#2DD4BF]"
          >
            {s}
            <button
              onClick={() => removeSkill(s)}
              aria-label={`Remove ${s}`}
              className="rounded p-0.5 hover:bg-[#1E293B] text-[#2DD4BF]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="relative flex min-w-[140px] flex-1 items-center">
          <input
            value={input}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                e.preventDefault();
                if (suggestions[0]) addSkill(suggestions[0]);
                else addSkill(input);
              }
              if (e.key === "Backspace" && !input && selected.length) {
                removeSkill(selected[selected.length - 1]);
              }
            }}
            placeholder="[type to add...]"
            className="w-full bg-transparent text-xs text-white placeholder:text-[#475569] placeholder:italic focus:outline-none font-[var(--font-heading)]"
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-2 w-48 rounded-md border border-[#1E293B] bg-[#0F172A] p-1 shadow-xl">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => addSkill(s)}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-[#CBD5E1] hover:bg-[#1E293B] hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="ml-auto hidden text-[11px] text-[#475569] sm:block">
          Showing {selected.length} of {max} skills (max {max})
        </span>
      </div>
      <span className="text-[11px] text-[#475569] sm:hidden">
        Showing {selected.length} of {max} skills (max {max})
      </span>
    </div>
  );
}
