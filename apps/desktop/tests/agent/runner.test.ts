import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agentToml, prepareCodexWorkspace } from "../../src/main/agent/providers";
import { AgentRunner, explainFailure } from "../../src/main/agent/runner";
import { campaignTask } from "../../src/main/agent/tasks";
import { type ApiServer, startApiServer } from "../../src/main/api/server";
import { Db } from "../../src/main/db/database";
import { createServices, type Services } from "../../src/main/services";
import { EventBus } from "../../src/main/services/context";
import type { AgentRun } from "../../src/main/services/runs";

const AGENT_DIR = join(__dirname, "../../agent");
const FAKE = join(__dirname, "../fixtures/fake-agent.mjs");

let dir: string;
let logDir: string;
let db: Db;
let services: Services;
let api: ApiServer;
const originalPath = process.env.PATH;

function installFake(name: string) {
  const bin = join(dir, "fake-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, name);
  writeFileSync(script, `#!/bin/sh\nFAKE_AGENT_PROVIDER=${name} exec node "${FAKE}" "$@"\n`);
  chmodSync(script, 0o755);
  process.env.PATH = `${bin}:${originalPath}`;
}

function waitForFinish(runner: AgentRunner): Promise<AgentRun> {
  return new Promise((resolve) => runner.once("finished", resolve));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "resumeapplyr-runner-"));
  logDir = join(dir, "logs");
  mkdirSync(logDir);
  process.env.FAKE_AGENT_LOG_DIR = logDir;
  db = new Db(join(dir, "app.db"));
  services = createServices({
    db,
    events: new EventBus(),
    now: () => new Date(),
    pdf: { render: async () => Buffer.from("%PDF-1.4") },
    paths: {
      root: dir,
      db: join(dir, "app.db"),
      resumes: join(dir, "resumes"),
      browserProfile: join(dir, "browser-profile"),
      agentWorkspace: join(dir, "workspace"),
      runs: join(dir, "workspace", "runs"),
      agentDir: AGENT_DIR,
    },
  });
  services.profile.save({ firstName: "Asha", lastName: "Verma", contactEmail: "asha@example.com", phone: "1" });
  api = await startApiServer(services, { version: "test" });
});

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.FAKE_AGENT_MODE;
});

afterAll(async () => {
  await api.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const runner = () =>
  new AgentRunner({ services, paths: services.ctx.paths, api });

describe("Claude Code runs", () => {
  it("starts claude headless with the plugin, browser and API wired up, and records the activity", async () => {
    installFake("claude");
    services.settings.update({ provider: "claude", model: "sonnet", browserChannel: "chrome" });
    const campaign = services.campaigns.create({ query: "frontend engineer pune", source: "search", config: { board: "linkedin.com" } });
    const r = runner();
    const done = waitForFinish(r);
    const started = await r.start(campaignTask(campaign));
    expect(r.current()?.runId).toBe(started.id);
    const finished = await done;

    expect(finished.status).toBe("succeeded");
    expect(finished.summary).toBe("Saved 1 job for Asha.");
    expect(finished.costUsd).toBeCloseTo(0.0123);

    const launch = JSON.parse(readFileSync(join(logDir, "claude-launch.json"), "utf8"));
    const argv: string[] = launch.argv;
    expect(argv).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--strict-mcp-config", "--no-session-persistence"]));
    expect(argv[argv.indexOf("--plugin-dir") + 1]).toBe(AGENT_DIR);
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("auto");
    expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
    const mcp = JSON.parse(readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8"));
    expect(mcp.mcpServers.playwright.args).toEqual(
      expect.arrayContaining(["@playwright/mcp@0.0.83", "--user-data-dir", join(dir, "browser-profile"), "--browser", "chrome"]),
    );
    expect(launch.prompt).toContain("resumeapplyr:search");
    expect(launch.prompt).toContain(`--campaign ${campaign.id}`);
    expect(launch.env.hasToken).toBe(true);
    expect(launch.env.RESUMEAPPLYR_RUN_ID).toBe(started.id);
    expect(launch.cwd).toBe(launch.env.RESUMEAPPLYR_TEMP);

    const events = services.runs.events(started.id).map((e) => `${e.kind}: ${e.text}`);
    expect(events).toContain("tool: API GET /api/user");
    expect(events).toContain("tool: Opened https://jobs.example.com/search");
    expect(events).toContain("result: Saved 1 job for Asha.");

    const saved = services.campaigns.get(campaign.id);
    expect(saved.status).toBe("completed");
    expect(services.campaigns.job(campaign.id, "fake-1").matchScore).toBe(88);
    expect(r.current()).toBeNull();
  });

  it("refuses a second run while one is going, and stops a run on request", async () => {
    installFake("claude");
    process.env.FAKE_AGENT_MODE = "slow";
    const r = runner();
    const done = waitForFinish(r);
    await r.start({ skill: "review-resume", args: "x", title: "Slow run" });
    await expect(r.start({ skill: "review-resume", args: "y", title: "Another" })).rejects.toThrow(/already working/);
    await new Promise((resolve) => setTimeout(resolve, 600));
    r.stop();
    const finished = await done;
    expect(finished.status).toBe("stopped");
  });

  it("explains a sign-in failure in plain words", async () => {
    installFake("claude");
    process.env.FAKE_AGENT_MODE = "unauthenticated";
    const r = runner();
    const done = waitForFinish(r);
    await r.start({ skill: "review-resume", args: "x", title: "Needs login" });
    const finished = await done;
    expect(finished.status).toBe("failed");
    expect(finished.error).toMatch(/isn't signed in/);
  });

  it("fails cleanly when the CLI isn't installed", async () => {
    process.env.PATH = join(dir, "empty-bin");
    const finished = await runner().start({ skill: "review-resume", args: "x", title: "No CLI" });
    expect(finished.status).toBe("failed");
    expect(finished.error).toMatch(/isn't installed/);
  });
});

describe("Codex runs", () => {
  it("prepares the Codex workspace and passes the browser as config overrides", async () => {
    installFake("codex");
    services.settings.update({ provider: "codex", model: "" });
    const campaign = services.campaigns.create({ query: "designer", source: "search", config: { board: "linkedin.com" } });
    const r = runner();
    const done = waitForFinish(r);
    await r.start(campaignTask(campaign));
    const finished = await done;
    expect(finished.status).toBe("succeeded");
    expect(finished.summary).toBe("Saved 1 job for Asha.");

    const launch = JSON.parse(readFileSync(join(logDir, "codex-launch.json"), "utf8"));
    expect(launch.argv.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(launch.argv).toContain("-");
    expect(launch.argv.join(" ")).toContain('mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.83"');
    const workspace = join(dir, "workspace");
    expect(existsSync(join(workspace, ".agents", "skills", "search", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(workspace, ".codex", "agents", "job-applier.toml"), "utf8")).toMatch(/^name = "job-applier"/);
    services.settings.update({ provider: "claude" });
  });
});

describe("helpers", () => {
  it("turns an agent file into a Codex agent", () => {
    const toml = agentToml("---\nname: x\ndescription: >-\n  two\n  lines\ntools: Bash\n---\n\nBody text");
    expect(toml).toBe('name = "x"\ndescription = "two lines"\ndeveloper_instructions = "Body text"\n');
    expect(agentToml("no frontmatter")).toBeNull();
  });

  it("copies the skill tree for Codex", () => {
    const ws = join(dir, "ws2");
    prepareCodexWorkspace(AGENT_DIR, ws);
    expect(existsSync(join(ws, ".agents", "skills", "_shared", "campaign-flow.md"))).toBe(true);
  });

  it("recognises sign-in errors from either provider", () => {
    expect(explainFailure("codex", "Error: not logged in. Run codex login")).toMatch(/codex login/);
    expect(explainFailure("claude", "something else entirely")).toBeNull();
  });
});
