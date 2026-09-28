"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ALL_SKILLS, SKILLS_DICTIONARY, normalizeSkill } from "@/lib/skills-dictionary";

type Props = {
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
};

export function SkillSelector({ selected, onChange, max = 15 }: Props) {
  const [input, setInput] = useState("");
  const [ suggestions, setSuggestions] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);

  // Dictionary-only matching: canonical substring OR alias substring.
  // Aliases keep working ("k8s" → kubernetes) without ever accepting
  // a string outside the dictionary.
  const handleInput = (val: string) => {
    setInput(val);
    setHighlight(-1);
    if (!val.trim()) {
      setSuggestions([]);
      return;
    }
    const lower = val.toLowerCase();
    const filtered = ALL_SKILLS.filter((s) => {
      if (selected.includes(s)) return false;
      if (s.includes(lower)) return true;
      return SKILLS_DICTIONARY[s]?.aliases.some((a) => a.includes(lower)) ?? false;
    }).slice(0, 6);
    setSuggestions(filtered);
  };

  const addSkill = (raw: string) => {
    const normalized = normalizeSkill(raw) ?? raw.toLowerCase().trim();
    if (!normalized) return;
    if (selected.includes(normalized)) {
      setInput("");
      setSuggestions([]);
      setHighlight(-1);
      return;
    }
    if (selected.length >= max) return;
    if (!ALL_SKILLS.includes(normalized)) return;
    onChange([...selected, normalized]);
    setInput("");
    setSuggestions([]);
    setHighlight(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
      return;
    }
    if (e.key === "Escape") {
      setSuggestions([]);
      setHighlight(-1);
      return;
    }
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      // Dictionary-only: Enter selects the highlighted (or first) suggestion.
      // With no suggestion there is no valid submission — free text is rejected.
      const pick = highlight >= 0 && highlight < suggestions.length
        ? suggestions[highlight]
        : suggestions[0];
      if (pick) addSkill(pick);
    }
    if (e.key === "Backspace" && !input && selected.length) {
      removeSkill(selected[selected.length - 1]);
    }
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
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Deferred so a click on a suggestion still registers first.
              setTimeout(() => {
                setSuggestions([]);
                setHighlight(-1);
              }, 120);
            }}
            placeholder="[type to add...]"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="skill-selector-listbox"
            aria-activedescendant={highlight >= 0 && suggestions[highlight] ? `skill-option-${suggestions[highlight]}` : undefined}
            autoComplete="off"
            className="w-full bg-transparent text-xs text-white placeholder:text-[#475569] placeholder:italic focus:outline-none font-[var(--font-heading)]"
          />
          {suggestions.length > 0 ? (
            <div
              id="skill-selector-listbox"
              role="listbox"
              className="absolute left-0 top-full z-20 mt-2 w-48 rounded-md border border-[#1E293B] bg-[#0F172A] p-1 shadow-xl"
            >
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  id={`skill-option-${s}`}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addSkill(s)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs ${i === highlight ? "bg-[#1E293B] text-white" : "text-[#CBD5E1] hover:bg-[#1E293B] hover:text-white"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : input.trim() ? (
            <div className="absolute left-0 top-full z-20 mt-2 w-48 rounded-md border border-[#1E293B] bg-[#0F172A] p-1 shadow-xl">
              <p className="px-2 py-1.5 text-[11px] text-[#475569]">No matching skills — pick from the dictionary</p>
            </div>
          ) : null}
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
