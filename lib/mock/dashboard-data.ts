export type SkillRow = {
  rank: number;
  skill: string;
  count: number;
  delta: number; // MoM %
  source?: string;
};

export const mockTopSkills: SkillRow[] = [
  { rank: 1, skill: "typescript", count: 8432, delta: 34.2 },
  { rank: 2, skill: "react", count: 7891, delta: 8.1 },
  { rank: 3, skill: "python", count: 7203, delta: -2.4 },
  { rank: 4, skill: "node.js", count: 6420, delta: 5.3 },
  { rank: 5, skill: "postgresql", count: 5988, delta: 14.6 },
  { rank: 6, skill: "docker", count: 5632, delta: 0.8 },
  { rank: 7, skill: "aws", count: 5348, delta: -3.5 },
  { rank: 8, skill: "kubernetes", count: 4810, delta: 27.4 },
  { rank: 9, skill: "go", count: 4489, delta: 22.1 },
  { rank: 10, skill: "rust", count: 3921, delta: 19.0 },
  { rank: 11, skill: "next.js", count: 3510, delta: 11.2 },
  { rank: 12, skill: "vue", count: 3298, delta: 6.4 },
  { rank: 13, skill: "graphql", count: 3102, delta: 9.1 },
  { rank: 14, skill: "tailwindcss", count: 2987, delta: 18.3 },
  { rank: 15, skill: "mongodb", count: 2844, delta: -1.2 },
  { rank: 16, skill: "redis", count: 2711, delta: 4.7 },
  { rank: 17, skill: "java", count: 2603, delta: -0.9 },
  { rank: 18, skill: "c++", count: 2441, delta: 2.3 },
  { rank: 19, skill: "swift", count: 2219, delta: 7.8 },
  { rank: 20, skill: "kotlin", count: 2098, delta: 12.4 },
  { rank: 21, skill: "flutter", count: 1987, delta: 15.2 },
  { rank: 22, skill: "django", count: 1876, delta: -2.1 },
  { rank: 23, skill: "laravel", count: 1765, delta: 3.3 },
  { rank: 24, skill: "angular", count: 1654, delta: -14.2 },
  { rank: 25, skill: "svelte", count: 1543, delta: 8.9 },
  { rank: 26, skill: "elixir", count: 1432, delta: 5.5 },
  { rank: 27, skill: "rust", count: 3921, delta: 19.0 }, // filler dup removed below - trimmed
].slice(0, 26);

export const mockStats = {
  jobsIngested: 42891,
  jobsDelta: 1204,
  skillsTracked: 240,
  skillsDelta: 8,
  topSkill: "typescript",
  topSkillCount: 8432,
  lastUpdate: "2 hours ago",
  monthLabel: "August 2026",
  postingsLabel: "42,891 postings across 4 sources",
};

export const mockSources = [
  { name: "HackerNews", count: 12430, pct: 43.5, color: "#FB923C" },
  { name: "Himalayas", count: 7891, pct: 27.6, color: "#2DD4BF" },
  { name: "RemoteJobs", count: 5203, pct: 18.2, color: "#A78BFA" },
  { name: "Remotive", count: 3011, pct: 10.7, color: "#475569" },
];

export const mockMovers = {
  rising: [
    { skill: "kubernetes", delta: 27 },
    { skill: "go", delta: 22 },
    { skill: "rust", delta: 19 },
  ],
  declining: [
    { skill: "ruby", delta: -18 },
    { skill: "angular", delta: -14 },
    { skill: "jquery", delta: -12 },
  ],
};

export const mockTrendData = {
  "3M": [
    { month: "Jun '26", typescript: 7100, react: 7400, python: 6800, "node.js": 6000, postgresql: 5400 },
    { month: "Jul '26", typescript: 7900, react: 7700, python: 7000, "node.js": 6250, postgresql: 5700 },
    { month: "Aug '26", typescript: 8432, react: 7891, python: 7203, "node.js": 6420, postgresql: 5988 },
  ],
  "6M": [
    { month: "Mar '26", typescript: 5400, react: 6200, python: 6400, "node.js": 5400, postgresql: 4800 },
    { month: "Apr '26", typescript: 6100, react: 6600, python: 6600, "node.js": 5800, postgresql: 5200 },
    { month: "May '26", typescript: 6800, react: 7000, python: 6800, "node.js": 6100, postgresql: 5500 },
    { month: "Jun '26", typescript: 7400, react: 7400, python: 6900, "node.js": 6250, postgresql: 5700 },
    { month: "Jul '26", typescript: 8000, react: 7700, python: 7050, "node.js": 6350, postgresql: 5850 },
    { month: "Aug '26", typescript: 8432, react: 7891, python: 7203, "node.js": 6420, postgresql: 5988 },
  ],
  "12M": [
    { month: "Sep '25", typescript: 4200, react: 5800, python: 6100, "node.js": 5000, postgresql: 4400 },
    { month: "Oct '25", typescript: 4500, react: 5900, python: 6200, "node.js": 5100, postgresql: 4500 },
    { month: "Nov '25", typescript: 4800, react: 6000, python: 6300, "node.js": 5200, postgresql: 4600 },
    { month: "Dec '25", typescript: 5000, react: 6100, python: 6350, "node.js": 5300, postgresql: 4700 },
    { month: "Jan '26", typescript: 5200, react: 6150, python: 6380, "node.js": 5350, postgresql: 4750 },
    { month: "Feb '26", typescript: 5300, react: 6180, python: 6400, "node.js": 5380, postgresql: 4780 },
    { month: "Mar '26", typescript: 5400, react: 6200, python: 6400, "node.js": 5400, postgresql: 4800 },
    { month: "Apr '26", typescript: 6100, react: 6600, python: 6600, "node.js": 5800, postgresql: 5200 },
    { month: "May '26", typescript: 6800, react: 7000, python: 6800, "node.js": 6100, postgresql: 5500 },
    { month: "Jun '26", typescript: 7400, react: 7400, python: 6900, "node.js": 6250, postgresql: 5700 },
    { month: "Jul '26", typescript: 8000, react: 7700, python: 7050, "node.js": 6350, postgresql: 5850 },
    { month: "Aug '26", typescript: 8432, react: 7891, python: 7203, "node.js": 6420, postgresql: 5988 },
  ],
};
