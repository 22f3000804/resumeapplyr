// The fake agent's script for the end-to-end test. It talks to the app exactly as the real skills
// do (through resumeapplyr-api), including one question the user answers in the app window, so
// the test covers the whole loop: search, score, ask, approve, apply, record.
import { execFileSync } from "node:child_process";

const api = (...args) => {
  const out = execFileSync("resumeapplyr-api", args, { encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : null;
};
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
let toolId = 0;
const tool = (name, input) => say({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${++toolId}`, name, input }] } });
const text = (t) => say({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const JOBS = [
  {
    key: "kraftwerk-senior-fe",
    title: "Senior Frontend Engineer",
    company: "Kraftwerk Labs",
    location: "Berlin",
    salary: "€75,000 – €90,000",
    url: "https://jobs.example.com/kraftwerk/senior-frontend",
    matchScore: 88,
    matchReason: "React, TypeScript and design-system work match your last two roles. Berlin, no sponsorship needed.",
    brief: { skills: ["React", "TypeScript", "Design systems", "Accessibility"], requirements: ["5+ years building web apps", "Experience with a component library"], yearsExperience: 5, remote: false, employmentType: "Full-time" },
  },
  {
    key: "nordlicht-fe-dev",
    title: "Frontend Developer",
    company: "Nordlicht GmbH",
    location: "Berlin (hybrid)",
    url: "https://jobs.example.com/nordlicht/frontend-developer",
    matchScore: 72,
    matchReason: "Strong overlap on React and testing. Asks for Vue, which your CV doesn't mention.",
    brief: { skills: ["React", "Vue", "Jest"], requirements: ["3+ years frontend"], remote: false },
  },
  {
    key: "bahnhof-fullstack",
    title: "Full-stack Engineer",
    company: "Bahnhof Digital",
    location: "Remote (EU)",
    url: "https://jobs.example.com/bahnhof/full-stack",
    matchScore: 54,
    matchReason: "Mostly backend: Go and Postgres, where your CV is light.",
    brief: { skills: ["Go", "PostgreSQL", "React"], remote: true },
  },
];

async function search(campaignId) {
  tool("Bash", { command: "resumeapplyr-api GET /api/user" });
  const user = api("GET", "/api/user");
  const campaign = api("GET", `/api/campaigns/${campaignId}`);
  tool("mcp__playwright__browser_navigate", { url: `https://www.${campaign.config.board ?? "linkedin.com"}/jobs/search/` });
  text("The board wants a verification code before it shows results. Asking you in the app.");

  tool("Bash", { command: "resumeapplyr-api POST /api/questions" });
  const question = api(
    "POST",
    "/api/questions",
    "--data",
    JSON.stringify({
      kind: "verification",
      question: "Enter the code the job board just emailed you.",
      context: `Needed to search ${campaign.config.board ?? "the board"} for “${campaign.query}”.`,
      campaignId,
    }),
  );
  let answered = null;
  for (let i = 0; i < 6 && !answered; i++) {
    const state = api("GET", `/api/questions/${question.id}/wait`, "--query", "timeout=20");
    if (state.status !== "pending") answered = state;
  }
  if (!answered || answered.status !== "answered") {
    api("POST", `/api/campaigns/${campaignId}/status`, "--data", JSON.stringify({ status: "paused", reason: "Couldn't sign in to the board." }));
    return "Stopped: the sign-in code wasn't given.";
  }
  tool("mcp__playwright__browser_type", { element: "Verification code", text: answered.answer });
  text(`Signed in, ${user.user.firstName || "there"}. Reading the results.`);

  for (const job of JOBS) {
    await pause(150);
    tool("mcp__playwright__browser_navigate", { url: job.url });
    const { brief, ...rest } = job;
    const below = job.matchScore < (campaign.config.minScore ?? 60);
    api(
      "POST",
      `/api/campaigns/${campaignId}/jobs`,
      "--data",
      JSON.stringify({ ...rest, board: campaign.config.board, status: "pending", brief: JSON.stringify({ title: job.title, company: job.company, ...brief }) }),
    );
    if (below) {
      api(
        "POST",
        `/api/campaigns/${campaignId}/jobs/${job.key}/result`,
        "--data",
        JSON.stringify({ outcome: "skipped", skipReason: `Scored ${job.matchScore}, below your bar of ${campaign.config.minScore ?? 60}.` }),
      );
    }
  }
  return `Found ${JOBS.length} jobs for “${campaign.query}”: 2 worth a look (88 and 72), 1 skipped below your bar. Approve the ones you want in the app.`;
}

async function apply(campaignId) {
  const jobs = api("GET", `/api/campaigns/${campaignId}/jobs`, "--query", "status=approved", "--query", "limit=100");
  let sent = 0;
  for (const job of jobs.items) {
    tool("Bash", { command: `resumeapplyr-api PATCH /api/campaigns/${campaignId}/jobs/${job.key}` });
    api("PATCH", `/api/campaigns/${campaignId}/jobs/${job.key}`, "--data", JSON.stringify({ status: "applying" }));
    tool("mcp__playwright__browser_navigate", { url: job.url });
    await pause(200);
    tool("mcp__playwright__browser_fill_form", { fields: [{}, {}, {}, {}, {}, {}] });
    tool("mcp__playwright__browser_click", { element: "Submit application" });
    api(
      "POST",
      `/api/campaigns/${campaignId}/jobs/${job.key}/result`,
      "--data",
      JSON.stringify({ outcome: "applied", appliedAt: new Date().toISOString() }),
    );
    sent++;
  }
  return sent ? `Applied to ${sent} job${sent === 1 ? "" : "s"}. Nothing else is approved.` : "Nothing was approved, so nothing was sent.";
}

export async function run(prompt) {
  say({ type: "system", subtype: "init", model: "fake-sonnet", mcp_servers: [{ name: "playwright", status: "connected" }] });
  const skill = /resumeapplyr:([a-z-]+) skill/.exec(prompt)?.[1];
  const campaignId = /--campaign (\S+)/.exec(prompt)?.[1] ?? /campaign (\S+)/.exec(prompt)?.[1];
  tool("Skill", { skill });
  let summary = "Nothing to do.";
  if ((skill === "search" || skill === "auto-apply") && campaignId) summary = await search(campaignId);
  else if (skill === "apply" && campaignId) summary = await apply(campaignId);
  say({
    type: "result",
    subtype: "success",
    is_error: false,
    result: summary,
    total_cost_usd: 0.0421,
    usage: { input_tokens: 18_200, output_tokens: 2_100 },
  });
}
