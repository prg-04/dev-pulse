// Single source of truth for skill normalization — dictionary-based extraction (AGENTS §11)
// Keys are canonical lowercase, values include aliases.
export const SKILLS_DICTIONARY: Record<string, { canonical: string; aliases: string[] }> = {
  typescript: { canonical: "typescript", aliases: ["typescript", "ts"] },
  javascript: { canonical: "javascript", aliases: ["javascript", "js"] },
  react: { canonical: "react", aliases: ["react", "react.js"] },
  "next.js": { canonical: "next.js", aliases: ["next.js", "nextjs", "next"] },
  vue: { canonical: "vue", aliases: ["vue", "vue.js"] },
  angular: { canonical: "angular", aliases: ["angular"] },
  svelte: { canonical: "svelte", aliases: ["svelte"] },
  "node.js": { canonical: "node.js", aliases: ["node.js", "node", "nodejs"] },
  python: { canonical: "python", aliases: ["python"] },
  go: { canonical: "go", aliases: ["go", "golang"] },
  rust: { canonical: "rust", aliases: ["rust"] },
  java: { canonical: "java", aliases: ["java"] },
  "c++": { canonical: "c++", aliases: ["c++", "cpp"] },
  swift: { canonical: "swift", aliases: ["swift"] },
  kotlin: { canonical: "kotlin", aliases: ["kotlin"] },
  flutter: { canonical: "flutter", aliases: ["flutter"] },
  django: { canonical: "django", aliases: ["django"] },
  laravel: { canonical: "laravel", aliases: ["laravel"] },
  elixir: { canonical: "elixir", aliases: ["elixir"] },
  graphql: { canonical: "graphql", aliases: ["graphql", "gql"] },
  tailwindcss: { canonical: "tailwindcss", aliases: ["tailwindcss", "tailwind"] },
  postgresql: { canonical: "postgresql", aliases: ["postgresql", "postgres", "psql"] },
  mongodb: { canonical: "mongodb", aliases: ["mongodb", "mongo"] },
  redis: { canonical: "redis", aliases: ["redis"] },
  docker: { canonical: "docker", aliases: ["docker"] },
  kubernetes: { canonical: "kubernetes", aliases: ["kubernetes", "k8s"] },
  aws: { canonical: "aws", aliases: ["aws", "amazon web services"] },
};

export const ALL_SKILLS: string[] = Object.keys(SKILLS_DICTIONARY);

export const SKILL_COLORS: Record<string, string> = {
  typescript: "#2DD4BF",
  react: "#818CF8",
  python: "#34D399",
  "node.js": "#FB923C",
  postgresql: "#F472B6",
  go: "#22D3EE",
  rust: "#FB7185",
  kubernetes: "#A78BFA",
  docker: "#38BDF8",
  aws: "#FBBF24",
};

export function normalizeSkill(input: string): string | null {
  const lower = input.trim().toLowerCase();
  for (const { canonical, aliases } of Object.values(SKILLS_DICTIONARY)) {
    if (aliases.includes(lower) || canonical === lower) return canonical;
  }
  return null;
}

export function isKnownSkill(skill: string): boolean {
  return normalizeSkill(skill) !== null || ALL_SKILLS.includes(skill.toLowerCase());
}
