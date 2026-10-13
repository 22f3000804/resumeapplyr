// How each agent CLI is started for one headless run. Both get the same skill tree, the same
// browser (Playwright MCP on a persistent profile) and the same local API; launch details follow
// JobPilot's terminal host providers (https://github.com/suxrobgm/jobpilot, MIT).
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserChannel, ProviderId } from "../../core/schemas/settings";
import { type Launch, resolveLaunch } from "./executable";
import { claudeParser, codexParser, type OutputParser } from "./parse";
import type { ProviderStatus } from "../../shared/types";
export type { ProviderStatus };

/** Pinned so an upstream release can't change the browser tools under a running app. */
export const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83";

export interface RunSpec {
  skill: string;
  args: string;
  model: string;
  browserChannel: BrowserChannel;
  agentDir: string;
  runDir: string;
  workspaceDir: string;
  browserProfile: string;
  extraReadDirs: string[];
  env: NodeJS.ProcessEnv;
}

export interface PreparedLaunch {
  launch: Launch;
  /** The provider's own arguments; the runner puts `launch.prefixArgs` in front. */
  args: string[];
  cwd: string;
  /** Sent on stdin, so no shell ever parses the user's query. */
  prompt: string;
  parser: OutputParser;
}


const WINDOWS = process.platform === "win32";

const NOT_WATCHING =
  "The resumeapplyr app started this session and nobody is reading this chat, so don't ask questions here. When you need the user, use the app's questions API (see _shared/asking-the-user.md). Finish with a short plain-text summary.";

/** The Playwright MCP server as a command line, wrapped for Windows where npx is a .cmd file. */
export function playwrightServer(spec: Pick<RunSpec, "browserChannel" | "browserProfile" | "runDir">) {
  const args = [
    "-y",
    PLAYWRIGHT_MCP,
    "--browser",
    spec.browserChannel,
    "--user-data-dir",
    spec.browserProfile,
    "--snapshot-mode",
    "none",
    "--output-dir",
    spec.runDir,
  ];
  return WINDOWS ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout, stderr) =>
      resolve(`${stdout ?? ""}${stderr ?? ""}`),
    );
  });
}

async function probe(launch: Launch | null, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  if (!launch) return "";
  if (launch.viaCmd) return run(launch.command, [...launch.prefixArgs, launch.resolved, ...args], env);
  return run(launch.command, [...launch.prefixArgs, ...args], env);
}

export interface Provider {
  id: ProviderId;
  name: string;
  status(env: NodeJS.ProcessEnv): Promise<ProviderStatus>;
  prepare(spec: RunSpec): PreparedLaunch;
}

// ── Claude Code ──────────────────────────────────────────────────────────

const CLAUDE_REQUIRED_FLAGS = ["--plugin-dir", "--permission-mode", "--mcp-config", "--output-format"];

export const claude: Provider = {
  id: "claude",
  name: "Claude Code",
  async status(env) {
    const launch = resolveLaunch("claude", env);
    const version = (await probe(launch, ["--version"], env)).trim().split("\n")[0] || null;
    const help = await probe(launch, ["--help"], env);
    return {
      id: "claude",
      name: "Claude Code",
      installed: !!launch,
      path: launch?.resolved ?? null,
      version: launch ? version : null,
      missingFlags: launch ? CLAUDE_REQUIRED_FLAGS.filter((f) => !help.includes(f)) : [],
    };
  },
  prepare(spec) {
    const launch = resolveLaunch("claude", spec.env);
    if (!launch) throw new Error("Claude Code isn't installed, or isn't on PATH.");

    const mcpConfig = join(spec.runDir, "mcp.json");
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwright: playwrightServer(spec) } }, null, 2));

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "auto",
      // Anything that would wait for a permission prompt is refused instead: nobody is at a terminal.
      "--permission-prompts",
      "none",
      "--settings",
      join(spec.agentDir, "settings", "claude.json"),
      "--plugin-dir",
      spec.agentDir,
      "--mcp-config",
      mcpConfig,
      "--strict-mcp-config",
      "--allowedTools",
      "Bash(resumeapplyr-api *)",
      "mcp__playwright",
      "Skill",
      "Task",
      "Read",
      "Write",
      "--no-session-persistence",
    ];
    for (const dir of [spec.agentDir, ...spec.extraReadDirs]) args.push("--add-dir", dir);
    if (spec.model) args.push("--model", spec.model);

    const prompt = `Run the resumeapplyr:${spec.skill} skill with these arguments:\n\n${spec.args}\n\nFollow the skill exactly. ${NOT_WATCHING}`;
    return { launch, args, cwd: spec.runDir, prompt, parser: claudeParser() };
  },
};

// ── Codex ────────────────────────────────────────────────────────────────

const tomlString = (value: string) => JSON.stringify(value);

/**
 * A Claude agent file as a Codex agent, body inlined. Codex agents take no tool list and inherit
 * the session model, so only the name and description carry over. Null without both.
 * Ported from JobPilot's CodexProvider.AgentToml.
 */
export function agentToml(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (end < 0) return null;
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of lines.slice(1, end)) {
    if (key && line.startsWith(" ")) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      key = null;
      continue;
    }
    key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fields[key] = value === ">-" || value === ">" ? "" : value.replace(/^"|"$/g, "");
  }
  if (!fields.name || !fields.description) return null;
  const body = lines.slice(end + 1).join("\n").trim();
  return `name = ${tomlString(fields.name)}\ndescription = ${tomlString(fields.description)}\ndeveloper_instructions = ${tomlString(body)}\n`;
}

/** Codex finds skills in <root>/.agents/skills and workers in <root>/.codex/agents. */
export function prepareCodexWorkspace(agentDir: string, workspaceDir: string): void {
  const skills = join(workspaceDir, ".agents", "skills");
  rmSync(skills, { recursive: true, force: true });
  mkdirSync(skills, { recursive: true });
  cpSync(join(agentDir, "skills"), skills, { recursive: true });

  const agents = join(workspaceDir, ".codex", "agents");
  rmSync(agents, { recursive: true, force: true });
  mkdirSync(agents, { recursive: true });
  for (const file of readdirSync(join(agentDir, "agents")).filter((f) => f.endsWith(".md"))) {
    const toml = agentToml(readFileSync(join(agentDir, "agents", file), "utf8"));
    if (toml) writeFileSync(join(agents, file.replace(/\.md$/, ".toml")), toml);
  }
}

export const codex: Provider = {
  id: "codex",
  name: "Codex",
  async status(env) {
    const launch = resolveLaunch("codex", env);
    const version = (await probe(launch, ["--version"], env)).trim().split("\n")[0] || null;
    const help = await probe(launch, ["exec", "--help"], env);
    return {
      id: "codex",
      name: "Codex",
      installed: !!launch,
      path: launch?.resolved ?? null,
      version: launch ? version : null,
      missingFlags: launch ? ["--json", "--approve-for-me"].filter((f) => !help.includes(f)) : [],
    };
  },
  prepare(spec) {
    const launch = resolveLaunch("codex", spec.env);
    if (!launch) throw new Error("Codex isn't installed, or isn't on PATH.");
    prepareCodexWorkspace(spec.agentDir, spec.workspaceDir);

    const settingsFile = join(spec.agentDir, "settings", "codex.json");
    const overrides: string[] = existsSync(settingsFile)
      ? (JSON.parse(readFileSync(settingsFile, "utf8")).configOverrides ?? [])
      : [];
    const server = playwrightServer(spec);
    overrides.push(
      `mcp_servers.playwright.command=${tomlString(server.command)}`,
      `mcp_servers.playwright.args=[${server.args.map(tomlString).join(",")}]`,
      // npx fetches the server on first launch, which outruns Codex's default startup window.
      "mcp_servers.playwright.startup_timeout_sec=120",
    );
    if (spec.model) overrides.push(`model=${tomlString(spec.model)}`);

    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--approve-for-me",
      "-C",
      spec.workspaceDir,
      ...overrides.flatMap((o) => ["-c", o]),
      "-",
    ];
    const prompt = `Use the "${spec.skill}" skill from .agents/skills/${spec.skill}/SKILL.md with these arguments:\n\n${spec.args}\n\nFollow the skill exactly. ${NOT_WATCHING}`;
    return { launch, args, cwd: spec.workspaceDir, prompt, parser: codexParser() };
  },
};

export const PROVIDERS: Record<ProviderId, Provider> = { claude, codex };

/** Whether Node.js (npx) is on PATH: the browser tools are started with it. */
export async function nodeStatus(env: NodeJS.ProcessEnv): Promise<{ installed: boolean; version: string | null }> {
  const launch = resolveLaunch("node", env);
  if (!launch) return { installed: false, version: null };
  const version = (await probe(launch, ["--version"], env)).trim() || null;
  return { installed: true, version };
}
