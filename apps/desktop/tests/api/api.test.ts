import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiServer, startApiServer } from "../../src/main/api/server";
import { Db } from "../../src/main/db/database";
import { EventBus } from "../../src/main/services/context";
import { createServices, type Services } from "../../src/main/services";

const run = promisify(execFile);
const CLI = join(__dirname, "../../agent/bin/api.mjs");

let dir: string;
let db: Db;
let services: Services;
let api: ApiServer;
let clock = new Date("2026-10-13T10:00:00Z");

// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${api.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${api.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.arrayBuffer() };
}

const RESUME = {
  basics: { name: "Asha Verma", email: "asha@example.com", phone: "+91 98765 43210", location: "Pune, India" },
  summary: "Frontend engineer who builds design systems and checkout flows for consumer apps.",
  experience: [
    {
      company: "Kite Labs",
      title: "Senior Frontend Engineer",
      start: "Jan 2021",
      end: "Present",
      bullets: [
        "Built the React component library used by 6 product teams.",
        "Cut checkout load time by 40% by moving rendering to Next.js server components.",
      ],
    },
    { company: "Paperfold", title: "Frontend Engineer", start: "Jun 2018", end: "Dec 2020", bullets: ["Shipped the TypeScript migration across 120 screens."] },
  ],
  skills: [{ group: "Frontend", items: ["React", "TypeScript", "Next.js", "CSS"] }],
  education: [{ school: "College of Engineering Pune", degree: "B.Tech Computer Engineering", details: [] }],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "resumeapplyr-test-"));
  db = new Db(join(dir, "test.db"));
  services = createServices({
    db,
    events: new EventBus(),
    now: () => clock,
    pdf: { render: async () => Buffer.from("%PDF-1.4 fake") },
    paths: {
      root: dir,
      db: join(dir, "test.db"),
      resumes: join(dir, "resumes"),
      browserProfile: join(dir, "browser"),
      agentWorkspace: join(dir, "workspace"),
      runs: join(dir, "runs"),
      agentDir: join(__dirname, "../../agent"),
    },
  });
  api = await startApiServer(services, { version: "test", token: "test-token-123" });
});

afterAll(async () => {
  await api.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("access", () => {
  it("rejects calls without the token", async () => {
    const res = await fetch(`${api.url}/api/health`);
    expect(res.status).toBe(401);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const status = await new Promise<number>((resolve) => {
      const req = request(
        { host: "127.0.0.1", port: api.port, path: "/api/health", headers: { host: "evil.example", authorization: `Bearer ${api.token}` } },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.end();
    });
    expect(status).toBe(403);
  });

  it("answers health with the token", async () => {
    const res = await call("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, app: "resumeapplyr" });
  });
});

describe("profile and CVs", () => {
  it("reports an incomplete profile", async () => {
    const res = await call("GET", "/api/user");
    expect(res.body.profileComplete).toBe(false);
    expect(res.body.missing).toContain("first name");
  });

  it("imports a PDF, saves extracted content and prefills the empty profile", async () => {
    const pdfPath = join(dir, "Asha Verma CV.pdf");
    writeFileSync(pdfPath, "%PDF-1.4\n% minimal test file\n");
    const resume = services.resumes.importFile(pdfPath);
    expect(resume.isPrimary).toBe(true);
    expect(resume.label).toBe("Asha Verma CV");

    const saved = await call("PUT", `/api/resumes/${resume.id}`, { content: RESUME });
    expect(saved.status).toBe(200);
    expect(saved.body.hasData).toBe(true);

    const user = await call("GET", "/api/user");
    expect(user.body.user.firstName).toBe("Asha");
    expect(user.body.user.contactEmail).toBe("asha@example.com");
    expect(user.body.primaryResumeSourceAbsolutePath).toMatch(/\.pdf$/);
    expect(user.body.profileComplete).toBe(true);
  });

  it("refuses an upload that isn't a PDF", () => {
    const fake = join(dir, "notes.pdf");
    writeFileSync(fake, "hello");
    expect(() => services.resumes.importFile(fake)).toThrow(/isn't a PDF/);
  });

  it("tailors a variant and rejects an invented number with a 422", async () => {
    const id = services.resumes.primaryId()!;
    const ok = await call("POST", `/api/resumes/${id}/tailor`, {
      label: "Acme - Frontend Engineer",
      jobUrl: "https://jobs.example.com/acme/1",
      emphasizedTech: ["next.js", "typescript"],
      diffNotes: "Led with Next.js.",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.pdfUrl).toBe(`/api/resumes/variants/${ok.body.id}/pdf`);

    const bad = await call("POST", `/api/resumes/${id}/tailor`, {
      label: "Acme - Frontend Engineer",
      bulletRewrites: [
        {
          entryIndex: 0,
          bullets: [
            {
              original: "Built the React component library used by 6 product teams.",
              tailored: "Built the React component library used by 9 product teams.",
            },
          ],
        },
      ],
    });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body.details)).toMatch(/introduces number/);
  });

  it("serves CV PDFs", async () => {
    const id = services.resumes.primaryId()!;
    const res = await call("GET", `/api/resumes/${id}/pdf`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as ArrayBuffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("scores fit against the primary CV", async () => {
    const res = await call("POST", "/api/score-fit", {
      brief: { title: "Frontend Engineer", skills: ["React", "TypeScript", "Next.js"], requirements: ["React and TypeScript"], yearsExperience: 3 },
      minScore: 60,
    });
    expect(res.status).toBe(201);
    expect(res.body.strongMatches).toEqual(["React", "TypeScript", "Next.js"]);
    expect(res.body.score).toBeGreaterThanOrEqual(80);
  });
});

describe("campaign rules the agent can't break", () => {
  const job = (key: string, url: string, matchScore = 85) => ({
    key,
    title: "Frontend Engineer",
    company: `Company ${key}`,
    url,
    board: "linkedin.com",
    matchScore,
    matchReason: "Strong React match",
  });

  it("approve-first: the agent can't apply until the user approves", async () => {
    const campaign = services.campaigns.create({ query: "frontend engineer pune", source: "auto_apply", config: { board: "linkedin.com" } });
    expect((await call("POST", `/api/campaigns/${campaign.id}/jobs`, job("a", "https://jobs.example.com/a"))).status).toBe(201);

    const refused = await call("PATCH", `/api/campaigns/${campaign.id}/jobs/a`, { status: "applying" });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Approve-first/);

    const selfApprove = await call("PATCH", `/api/campaigns/${campaign.id}/jobs/a`, { status: "approved" });
    expect(selfApprove.status).toBe(403);

    services.campaigns.approveJobs(campaign.id, ["a"]);
    const applying = await call("PATCH", `/api/campaigns/${campaign.id}/jobs/a`, { status: "applying" });
    expect(applying.status).toBe(200);
    expect(applying.body.status).toBe("applying");

    const result = await call("POST", `/api/campaigns/${campaign.id}/jobs/a/result`, {
      outcome: "applied",
      appliedAt: clock.toISOString(),
      matchScore: 85,
      resumeId: services.resumes.primaryId(),
    });
    expect(result.status).toBe(201);
    expect(result.body.application.status).toBe("applied");
    expect(result.body.application.unchecked).toBe(false);
  });

  it("skips a job already applied to and says so", async () => {
    const campaign = services.campaigns.create({ query: "again", source: "search", config: { board: "linkedin.com" } });
    await call("POST", `/api/campaigns/${campaign.id}/jobs`, job("b", "https://jobs.example.com/a?utm_source=x"));
    services.campaigns.approveJobs(campaign.id, ["b"]);
    const res = await call("PATCH", `/api/campaigns/${campaign.id}/jobs/b`, { status: "applying" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Already applied \(url\)/);
    expect(services.campaigns.job(campaign.id, "b")).toMatchObject({ status: "skipped", skipReason: "Already applied (url)" });
  });

  it("applied-check finds exact and fuzzy matches", async () => {
    const exact = await call("GET", "/api/applied/check?url=" + encodeURIComponent("https://www.jobs.example.com/a/"));
    expect(exact.body.applied).toBe(true);
    expect(exact.body.match.kind).toBe("url");
    const fuzzy = await call(
      "GET",
      `/api/applied/check?title=${encodeURIComponent("Senior Frontend Engineer")}&company=${encodeURIComponent("Company a Inc")}`,
    );
    expect(fuzzy.body.applied).toBe(true);
    expect(fuzzy.body.match.kind).toBe("fuzzy");
  });

  it("auto mode: applies above the threshold, refuses below it", async () => {
    services.settings.update({ approvalMode: "auto", autoApplyThreshold: 80 });
    const campaign = services.campaigns.create({ query: "auto", source: "auto_apply", config: { board: "linkedin.com" } });
    await call("POST", `/api/campaigns/${campaign.id}/jobs`, job("hi", "https://jobs.example.com/hi", 86));
    await call("POST", `/api/campaigns/${campaign.id}/jobs`, job("lo", "https://jobs.example.com/lo", 70));
    expect((await call("PATCH", `/api/campaigns/${campaign.id}/jobs/hi`, { status: "applying" })).status).toBe(200);
    const low = await call("PATCH", `/api/campaigns/${campaign.id}/jobs/lo`, { status: "applying" });
    expect(low.status).toBe(403);
    expect(low.body.message).toMatch(/70 < 80/);
    services.campaigns.releaseApplying(campaign.id, "test cleanup");
    services.settings.update({ approvalMode: "approve" });
  });

  it("enforces the daily limit", async () => {
    services.settings.update({ dailyApplicationLimit: 1 });
    const campaign = services.campaigns.create({ query: "limit", source: "auto_apply", config: { board: "linkedin.com" } });
    await call("POST", `/api/campaigns/${campaign.id}/jobs`, job("c", "https://jobs.example.com/c"));
    services.campaigns.approveJobs(campaign.id, ["c"]);
    const res = await call("PATCH", `/api/campaigns/${campaign.id}/jobs/c`, { status: "applying" });
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/Daily limit reached/);
    services.settings.update({ dailyApplicationLimit: 25 });
  });

  it("refuses to apply in a paused campaign, and the agent can't un-pause it", async () => {
    const campaign = services.campaigns.create({ query: "paused", source: "auto_apply", config: { board: "linkedin.com" } });
    await call("POST", `/api/campaigns/${campaign.id}/jobs`, job("d", "https://jobs.example.com/d"));
    services.campaigns.approveJobs(campaign.id, ["d"]);
    services.campaigns.setStatus(campaign.id, { status: "paused", reason: "Lunch" }, "user");
    const res = await call("PATCH", `/api/campaigns/${campaign.id}/jobs/d`, { status: "applying" });
    expect(res.status).toBe(409);
    const resume = await call("POST", `/api/campaigns/${campaign.id}/status`, { status: "in_progress" });
    expect(resume.status).toBe(403);
  });

  it("records an application that skipped the check, flagged as unchecked", async () => {
    const campaign = services.campaigns.create({ query: "unchecked", source: "auto_apply", config: { board: "linkedin.com" } });
    await call("POST", `/api/campaigns/${campaign.id}/jobs`, job("e", "https://jobs.example.com/e"));
    const res = await call("POST", `/api/campaigns/${campaign.id}/jobs/e/result`, { outcome: "applied", appliedAt: clock.toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.application.unchecked).toBe(true);
  });

  it("only accepts new jobs as queued or pending", async () => {
    const campaign = services.campaigns.create({ query: "status", source: "auto_apply", config: { board: "linkedin.com" } });
    const res = await call("POST", `/api/campaigns/${campaign.id}/jobs`, { ...job("f", "https://jobs.example.com/f"), status: "applying" });
    expect(res.status).toBe(400);
  });

  it("seeds pasted links as queued jobs", () => {
    const campaign = services.campaigns.create({
      query: "Pasted links",
      source: "apply",
      urls: ["https://boards.greenhouse.io/acme/jobs/1", "https://jobs.lever.co/beta/2"],
    });
    expect(campaign.summary.byStatus.queued).toBe(2);
  });
});

describe("questions", () => {
  it("long-polls until the user answers, and remembers reusable answers", async () => {
    const created = await call("POST", "/api/questions", {
      kind: "question",
      question: "What is your notice period?",
      answerKey: "notice_period",
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const early = await call("GET", `/api/questions/${id}/wait?timeout=1`);
    expect(early.body.status).toBe("pending");

    const waiting = call("GET", `/api/questions/${id}/wait?timeout=10`);
    setTimeout(() => services.questions.answer(id, { answer: "One month", remember: true }, services.answers), 100);
    const answered = await waiting;
    expect(answered.body).toMatchObject({ status: "answered", answer: "One month" });

    const answers = await call("GET", "/api/answers");
    expect(answers.body).toContainEqual({ key: "notice_period", value: "One month" });
  });
});

describe("resumeapplyr-api CLI", () => {
  const env = () => ({ ...process.env, RESUMEAPPLYR_API: api.url, RESUMEAPPLYR_API_TOKEN: api.token });

  it("prints the response body", async () => {
    const { stdout } = await run(process.execPath, [CLI, "GET", "/api/health"], { env: env() });
    expect(JSON.parse(stdout)).toMatchObject({ ok: true });
  });

  it("passes query parameters and reads bodies from files", async () => {
    const body = join(dir, "fit.json");
    writeFileSync(body, "﻿" + JSON.stringify({ brief: { title: "x", skills: ["React"] } }));
    const { stdout } = await run(process.execPath, [CLI, "POST", "/api/score-fit", "--data", `@${body}`], { env: env() });
    expect(JSON.parse(stdout).strongMatches).toEqual(["React"]);
  });

  it("refuses a path that leaves the API", async () => {
    await expect(run(process.execPath, [CLI, "GET", "//evil.example/x"], { env: env() })).rejects.toMatchObject({ code: 2 });
  });

  it("exits 1 with the API's message on an HTTP error", async () => {
    const error = await run(process.execPath, [CLI, "GET", "/api/campaigns/nope"], { env: env() }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toMatch(/HTTP 404/);
  });
});
