// Stands in for `claude` or `codex` in tests: records how it was started, then behaves like a
// short agent session that calls the app's API through resumeapplyr-api.
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const provider = process.env.FAKE_AGENT_PROVIDER ?? "claude";

// The app probes `--version` and `--help` before offering the tool; answer those without stdin.
if (process.argv.includes("--version")) {
  process.stdout.write(provider === "codex" ? "codex-cli 0.162.1\n" : "2.1.296 (Claude Code)\n");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.stdout.write(
    provider === "codex"
      ? "Usage: codex exec [OPTIONS] --json --approve-for-me --skip-git-repo-check --ephemeral\n"
      : "Usage: claude [options]\n  --plugin-dir --permission-mode --mcp-config --output-format --strict-mcp-config\n",
  );
  process.exit(0);
}

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;

if (process.env.FAKE_AGENT_MODE === "e2e") {
  await import("./fake-agent-e2e.mjs").then((m) => m.run(prompt));
  process.exit(0);
}

writeFileSync(
  join(process.env.FAKE_AGENT_LOG_DIR, `${provider}-launch.json`),
  JSON.stringify({ argv: process.argv.slice(2), prompt, cwd: process.cwd(), env: {
    RESUMEAPPLYR_API: process.env.RESUMEAPPLYR_API,
    RESUMEAPPLYR_TEMP: process.env.RESUMEAPPLYR_TEMP,
    RESUMEAPPLYR_RUN_ID: process.env.RESUMEAPPLYR_RUN_ID,
    RESUMEAPPLYR_SKILLS_ROOT: process.env.RESUMEAPPLYR_SKILLS_ROOT,
    hasToken: Boolean(process.env.RESUMEAPPLYR_API_TOKEN),
  } }, null, 2),
);

const api = (...args) => execFileSync("resumeapplyr-api", args, { encoding: "utf8" });
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
process.stderr.write("fake agent warming up\n");

if (process.env.FAKE_AGENT_MODE === "slow") {
  say({ type: "system", subtype: "init", model: "fake", mcp_servers: [] });
  setInterval(() => appendFileSync(join(process.env.FAKE_AGENT_LOG_DIR, "tick"), "."), 200);
  await new Promise(() => {});
}
if (process.env.FAKE_AGENT_MODE === "unauthenticated") {
  process.stderr.write("Invalid API key · Please run /login\n");
  process.exit(1);
}

const campaign = /--campaign (\S+)/.exec(prompt)?.[1] ?? /campaign (\S+)/.exec(prompt)?.[1];
if (provider === "claude") {
  say({ type: "system", subtype: "init", model: "fake-sonnet", mcp_servers: [{ name: "playwright", status: "connected" }] });
  say({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "resumeapplyr-api GET /api/user" } }] } });
} else {
  say({ type: "thread.started", thread_id: "th_1" });
  say({ type: "item.started", item: { id: "i1", type: "command_execution", command: "resumeapplyr-api GET /api/user", status: "in_progress" } });
}
const user = JSON.parse(api("GET", "/api/user"));
if (provider === "claude") {
  say({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "mcp__playwright__browser_navigate", input: { url: "https://jobs.example.com/search" } }] } });
} else {
  say({ type: "item.started", item: { id: "i2", type: "mcp_tool_call", server: "playwright", tool: "browser_navigate", arguments: { url: "https://jobs.example.com/search" } } });
}

if (campaign) {
  const body = join(process.env.RESUMEAPPLYR_TEMP, "job-fake.json");
  writeFileSync(body, JSON.stringify({
    key: "fake-1", title: "Frontend Engineer", company: "Fake Co", url: "https://jobs.example.com/fake-1",
    board: "jobs.example.com", matchScore: 88, matchReason: "React and TypeScript match", status: "pending",
    brief: JSON.stringify({ title: "Frontend Engineer", skills: ["React"] }),
  }));
  api("POST", `/api/campaigns/${campaign}/jobs`, "--data", `@${body}`);
  api("POST", `/api/campaigns/${campaign}/status`, "--data", '{"status":"completed"}');
}

const summary = `Saved 1 job for ${user.user.firstName || "you"}.`;
if (provider === "claude") {
  say({ type: "result", subtype: "success", is_error: false, result: summary, total_cost_usd: 0.0123, usage: { input_tokens: 1200, output_tokens: 300 } });
} else {
  say({ type: "item.completed", item: { id: "i3", type: "agent_message", text: summary } });
  say({ type: "turn.completed", usage: { input_tokens: 900, cached_input_tokens: 0, output_tokens: 200 } });
}
