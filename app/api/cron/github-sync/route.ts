import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Octokit } from "octokit";
import { ALL_SKILLS, normalizeSkill } from "@/lib/skills-dictionary";

export const runtime = "nodejs";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  languages_url: string;
  topics: string[];
}

interface RepoLanguages {
  [language: string]: number;
}

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured");
  }
  return new Octokit({ auth: token });
}

async function fetchAllRepos(
  octokit: Octokit,
  username: string
): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await octokit.request("GET /users/{username}/repos", {
      username,
      per_page: perPage,
      page,
      sort: "updated",
      direction: "desc",
      type: "owner",
    });

    const items = response.data as GitHubRepo[];
    repos.push(...items);

    if (items.length < perPage) break;
    page++;
  }

  return repos;
}

async function fetchRepoLanguages(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepoLanguages> {
  try {
    const response = await octokit.request("GET /repos/{owner}/{repo}/languages", {
      owner,
      repo,
    });
    return response.data as RepoLanguages;
  } catch {
    return {};
  }
}

function normalizeGitHubValue(value: string): string | null {
  const normalized = normalizeSkill(value);
  if (!normalized) return null;
  // Only keep values that are in the full dictionary
  return ALL_SKILLS.includes(normalized) ? normalized : null;
}

function extractSkillsFromRepo(
  repo: GitHubRepo,
  languages: RepoLanguages
): Set<string> {
  const skills = new Set<string>();

  // Normalize language names
  for (const lang of Object.keys(languages)) {
    const normalized = normalizeGitHubValue(lang);
    if (normalized) {
      skills.add(normalized);
    }
  }

  // Normalize topics
  for (const topic of repo.topics ?? []) {
    const normalized = normalizeGitHubValue(topic);
    if (normalized) {
      skills.add(normalized);
    }
  }

  return skills;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return NextResponse.json({ error: "GITHUB_TOKEN is not configured" }, { status: 500 });
  }

  const octokit = getOctokit();

  // 1. Select profiles where auto_git_sync = true and github_username is not null
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, github_username, auto_git_sync")
    .eq("auto_git_sync", true)
    .not("github_username", "is", null);

  if (profilesError) {
    return NextResponse.json(
      { error: `Failed to fetch profiles: ${profilesError.message}` },
      { status: 500 }
    );
  }

  const results: Array<{
    userId: string;
    githubUsername: string;
    status: string;
    skillsUpserted: number;
    error?: string;
  }> = [];

  // 2. Process each profile independently
  for (const profile of profiles ?? []) {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // Create github_sync_runs record
    const { error: runInsertError } = await supabase
      .from("github_sync_runs")
      .insert({
        id: runId,
        user_id: profile.id,
        github_username: profile.github_username,
        started_at: startedAt,
        status: null,
        skills_upserted: 0,
      });

    if (runInsertError) {
      console.error(`[github-sync] Failed to create run for ${profile.github_username}:`, runInsertError);
      results.push({
        userId: profile.id,
        githubUsername: profile.github_username,
        status: "failed",
        skillsUpserted: 0,
        error: `Failed to create sync run: ${runInsertError.message}`,
      });
      continue;
    }

    try {
      // 3. Fetch all repos for the user
      let repos: GitHubRepo[];
      try {
        repos = await fetchAllRepos(octokit, profile.github_username);
      } catch (err) {
        // Check if this is a 404 (username not found)
        if (err instanceof Error && err.message.includes("404")) {
          await supabase
            .from("github_sync_runs")
            .update({
              completed_at: new Date().toISOString(),
              status: "skipped_no_username",
              error: `GitHub username '${profile.github_username}' not found (404)`,
            })
            .eq("id", runId);

          results.push({
            userId: profile.id,
            githubUsername: profile.github_username,
            status: "skipped_no_username",
            skillsUpserted: 0,
            error: `GitHub username '${profile.github_username}' not found`,
          });
          continue;
        }
        throw err;
      }

      if (repos.length === 0) {
        await supabase
          .from("github_sync_runs")
          .update({
            completed_at: new Date().toISOString(),
            status: "success",
            skills_upserted: 0,
          })
          .eq("id", runId);

        results.push({
          userId: profile.id,
          githubUsername: profile.github_username,
          status: "success",
          skillsUpserted: 0,
        });
        continue;
      }

      // 4. Fetch languages for all repos in parallel (with rate limit awareness)
      // GitHub allows 5000 req/hr with PAT, but let's batch carefully
      const repoSkillsMap = new Map<string, Set<string>>();

      // Process in batches of 10 to avoid hitting rate limits
      const batchSize = 10;
      for (let i = 0; i < repos.length; i += batchSize) {
        const batch = repos.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (repo) => {
            const [owner, repoName] = repo.full_name.split("/");
            const languages = await fetchRepoLanguages(octokit, owner, repoName);
            const skills = extractSkillsFromRepo(repo, languages);
            return { repoId: repo.id, skills };
          })
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            repoSkillsMap.set(result.value.repoId.toString(), result.value.skills);
          }
        }
      }

      // 5. Aggregate all skills across repos
      const aggregatedSkills = new Set<string>();
      for (const skills of repoSkillsMap.values()) {
        for (const skill of skills) {
          aggregatedSkills.add(skill);
        }
      }

      if (aggregatedSkills.size === 0) {
        await supabase
          .from("github_sync_runs")
          .update({
            completed_at: new Date().toISOString(),
            status: "success",
            skills_upserted: 0,
          })
          .eq("id", runId);

        results.push({
          userId: profile.id,
          githubUsername: profile.github_username,
          status: "success",
          skillsUpserted: 0,
        });
        continue;
      }

      // 6. Fetch existing manual skills for this user (to preserve precedence)
      const { data: existingSkills, error: skillsError } = await supabase
        .from("user_skills")
        .select("skill, source")
        .eq("user_id", profile.id);

      if (skillsError) {
        throw new Error(`Failed to fetch existing skills: ${skillsError.message}`);
      }

      const manualSkills = new Set(
        (existingSkills ?? [])
          .filter((row) => row.source === "manual")
          .map((row) => row.skill)
      );

      // 7. Upsert github_sync skills, skipping manual entries
      const skillsToUpsert = Array.from(aggregatedSkills).filter(
        (skill) => !manualSkills.has(skill)
      );

      let upsertedCount = 0;

      if (skillsToUpsert.length > 0) {
        const rows = skillsToUpsert.map((skill) => ({
          user_id: profile.id,
          skill,
          source: "github_sync" as const,
          updated_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from("user_skills")
          .upsert(rows, { onConflict: "user_id,skill" });

        if (upsertError) {
          console.error(`[github-sync] Failed to upsert skills for ${profile.github_username}:`, upsertError);
        } else {
          upsertedCount = skillsToUpsert.length;
        }
      }

      // 8. Update github_sync_runs with success
      const completedAt = new Date().toISOString();
      await supabase
        .from("github_sync_runs")
        .update({
          completed_at: completedAt,
          status: "success",
          skills_upserted: upsertedCount,
        })
        .eq("id", runId);

      results.push({
        userId: profile.id,
        githubUsername: profile.github_username,
        status: "success",
        skillsUpserted: upsertedCount,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[github-sync] Error processing ${profile.github_username}:`, errorMessage);

      // Update run as failed
      await supabase
        .from("github_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          error: errorMessage,
        })
        .eq("id", runId);

      results.push({
        userId: profile.id,
        githubUsername: profile.github_username,
        status: "failed",
        skillsUpserted: 0,
        error: errorMessage,
      });
    }
  }

  const totalSkillsUpserted = results.reduce((sum, r) => sum + r.skillsUpserted, 0);
  const successCount = results.filter((r) => r.status === "success").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({
    ok: true,
    profilesProcessed: results.length,
    successCount,
    failedCount,
    totalSkillsUpserted,
    results,
  });
}
