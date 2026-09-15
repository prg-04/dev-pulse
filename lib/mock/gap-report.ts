export const mockGapReport = {
  marketAlignmentPct: 74,
  index: 0.742,
  deltaSinceQuarter: 6.8,
  targetBaseline: 60,
  topTierThreshold: 80,
  strengths: [
    { skill: "typescript", count: 8432 },
    { skill: "react", count: 7891 },
    { skill: "postgresql", count: 4110 },
  ],
  strengthsSummary:
    "Strong alignment with current top-tier US remote requirements. TypeScript and React represent the highest volume pair in our dataset.",
  gaps: [
    { skill: "kubernetes", count: 3840 },
    { skill: "rust", count: 1920 },
    { skill: "graphql", count: 2410 },
  ],
  rising: [
    { skill: "go", delta: 22 },
    { skill: "tailwindcss", delta: 18 },
    { skill: "next.js", delta: 15 },
  ],
  risingSummary: "Go continues rapid adoption in US backend microservices.",
  declining: [
    { skill: "redux", delta: -12 },
    { skill: "rest", delta: -9 },
  ],
  decliningSummary: "Redux boilerplate is increasingly superseded by server actions and lightweight state stores.",
  recommendations: [
    "Prioritize Kubernetes fundamentals for multi-container deployments",
    "Emphasize your PostgreSQL indexing and performance tuning expertise",
    "Consider expanding into Go for high-concurrency microservices",
  ],
  totalPostings: 42891,
  monthLabel: "August 2026",
  yourSkills: ["typescript", "react", "node.js", "postgresql", "docker", "aws"],
};

export const mockGapReportTutorialsNote = "Adding Kubernetes container orchestration would expand your eligibility to 68% of senior DevOps-adjacent fullstack roles.";
