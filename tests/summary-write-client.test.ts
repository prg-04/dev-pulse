import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const LONG_DESC =
  "Acme Corp is hiring a senior backend engineer to build distributed systems. " +
  "You will design APIs, own Postgres schemas, and mentor junior engineers. " +
  "Requirements include five years of Go, Kubernetes experience, and strong communication skills. " +
  "We offer remote-first work, competitive pay, and equity for every employee on the team.";

function chainResolve(data: unknown) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      })),
    })),
  };
}

describe("GET /api/jobs/[id]/summary (split-client: session reads, service writes)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads via session client but inserts the cache row via service client", async () => {
    const sessionFrom = vi.fn((table: string) => {
      if (table === "job_postings") {
        return chainResolve({ id: JOB_ID, title: "Backend Engineer", company: "Acme", description: LONG_DESC });
      }
      return chainResolve(null);
    });
    const serviceInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const serviceFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      insert: serviceInsert,
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    }));

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: sessionFrom,
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: serviceFrom });

    const { GET } = await import("@/app/api/jobs/[id]/summary/route");
    const req = new Request(`http://localhost/api/jobs/${JOB_ID}/summary`) as unknown as NextRequest;
    const res = await GET(req, { params: Promise.resolve({ id: JOB_ID }) });

    expect(res.status).toBe(200);
    // Reads go through the session client…
    expect(sessionFrom).toHaveBeenCalledWith("job_postings");
    expect(sessionFrom).toHaveBeenCalledWith("job_summaries");
    // …but the cache write goes through the service client (RLS has no
    // authenticated-write policy on job_summaries — session insert is 42501).
    expect(serviceFrom).toHaveBeenCalledWith("job_summaries");
    expect(serviceInsert).toHaveBeenCalledTimes(1);
    expect(serviceInsert.mock.calls[0][0]).toMatchObject({ job_id: JOB_ID });
  });
});
