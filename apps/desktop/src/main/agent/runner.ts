// Runs one agent session at a time: spawns the provider CLI headless, feeds it the skill on stdin,
// turns its output into activity events, and cleans up whatever it leaves behind.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { conflict } from "../../core/errors";
import type { ApiServer } from "../api/server";
import type { Services } from "../services";
import type { AppPaths } from "../services/context";
import type { AgentRun } from "../services/runs";
import { cmdLine, withPathPrefix } from "./executable";
import { type PreparedLaunch, PROVIDERS, type RunSpec } from "./providers";
import type { SkillName, ActiveRun } from "../../shared/types";
export type { SkillName, ActiveRun };

const WINDOWS = process.platform === "win32";
const MAX_STDERR_EVENTS = 200;


export interface AgentTask {
  skill: SkillName;
  args: string;
  title: string;
  campaignId?: string;
  resumeId?: string;
}


interface Active extends ActiveRun {
  child: ChildProcess;
  stopReason: "user" | "timeout" | null;
  timer: NodeJS.Timeout;
}

export interface RunnerDeps {
  services: Services;
  paths: AppPaths;
  api: ApiServer;
  /** Runs before each start, e.g. to close the sign-in browser that holds the profile. */
  beforeStart?: () => Promise<void>;
  /** Replaces the provider's launch; tests use it to run a fake agent. */
  prepare?: (spec: RunSpec) => PreparedLaunch;
}

/** Turns common sign-in failures into something the user can act on. */
export function explainFailure(provider: string, text: string): string | null {
  if (/not logged in|please run \/login|invalid api key|authenticat|unauthori[sz]ed|login required|codex login/i.test(text)) {
    return provider === "codex"
      ? "Codex isn't signed in. Open a terminal, run `codex login`, then try again."
      : "Claude Code isn't signed in. Open a terminal, run `claude`, sign in once, then try again.";
  }
  if (/ENOENT|not recognized|command not found/i.test(text)) {
    return `${provider === "codex" ? "Codex" : "Claude Code"} couldn't be started. Check it's installed and on PATH (Settings shows what the app found).`;
  }
  return null;
}

export class AgentRunner extends EventEmitter {
  private active: Active | null = null;

  constructor(private readonly deps: RunnerDeps) {
    super();
  }

  current(): ActiveRun | null {
    if (!this.active) return null;
    const { runId, title, skill, campaignId, startedAt } = this.active;
    return { runId, title, skill, campaignId, startedAt };
  }

  async start(task: AgentTask): Promise<AgentRun> {
    if (this.active) {
      throw conflict(`The agent is already working on "${this.active.title}". Stop it or wait for it to finish.`);
    }
    const { services, paths, api } = this.deps;
    const settings = services.settings.get();
    const provider = PROVIDERS[settings.provider];
    await this.deps.beforeStart?.();

    const run = services.runs.create({
      skill: task.skill,
      args: task.args,
      title: task.title,
      provider: provider.id,
      campaignId: task.campaignId ?? null,
      resumeId: task.resumeId ?? null,
    });
    const runDir = join(paths.runs, run.id);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(paths.browserProfile, { recursive: true });

    const env = withPathPrefix(
      {
        ...process.env,
        RESUMEAPPLYR_API: api.url,
        RESUMEAPPLYR_API_TOKEN: api.token,
        RESUMEAPPLYR_TEMP: runDir,
        RESUMEAPPLYR_SKILLS_ROOT: join(paths.agentDir, "skills"),
        RESUMEAPPLYR_RUN_ID: run.id,
        NO_COLOR: "1",
        ELECTRON_RUN_AS_NODE: undefined,
      },
      join(paths.agentDir, "bin"),
    );
    const spec: RunSpec = {
      skill: task.skill,
      args: task.args,
      model: settings.model,
      browserChannel: settings.browserChannel,
      agentDir: paths.agentDir,
      runDir,
      workspaceDir: paths.agentWorkspace,
      browserProfile: paths.browserProfile,
      extraReadDirs: [paths.resumes],
      env,
    };

    let prepared: PreparedLaunch;
    try {
      prepared = (this.deps.prepare ?? provider.prepare)(spec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      services.runs.addEvent(run.id, "error", message);
      return services.runs.finish(run.id, { status: "failed", error: message });
    }

    const { launch } = prepared;
    const args = launch.viaCmd
      ? [...launch.prefixArgs, cmdLine(launch.resolved, prepared.args)]
      : [...launch.prefixArgs, ...prepared.args];
    services.runs.addEvent(run.id, "info", `Starting ${provider.name} for: ${task.title}`);

    const child = spawn(launch.command, args, {
      cwd: prepared.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: !WINDOWS,
      windowsVerbatimArguments: launch.viaCmd,
    });
    const timer = setTimeout(() => this.stop("timeout"), settings.runTimeoutMinutes * 60_000);
    this.active = {
      runId: run.id,
      title: task.title,
      skill: task.skill,
      campaignId: task.campaignId ?? null,
      startedAt: run.startedAt,
      child,
      stopReason: null,
      timer,
    };
    this.emit("changed", this.current());

    const stderrTail: string[] = [];
    let stderrEvents = 0;
    let spawnError: string | null = null;

    createInterface({ input: child.stdout! }).on("line", (line) => {
      for (const event of prepared.parser.line(line)) services.runs.addEvent(run.id, event.kind, event.text, event.data);
    });
    createInterface({ input: child.stderr! }).on("line", (line) => {
      if (!line.trim()) return;
      stderrTail.push(line);
      if (stderrTail.length > 30) stderrTail.shift();
      if (stderrEvents++ < MAX_STDERR_EVENTS) services.runs.addEvent(run.id, "stderr", line.slice(0, 500));
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.stdin?.on("error", () => {
      // The process may exit before reading stdin (e.g. it couldn't start); the exit says why.
    });
    child.stdin?.end(prepared.prompt);

    child.on("close", (code) => {
      const active = this.active;
      clearTimeout(timer);
      const totals = prepared.parser.totals();
      const stopped = active?.stopReason ?? null;
      const status = stopped ? "stopped" : code === 0 && !totals.isError && !spawnError ? "succeeded" : "failed";
      const tail = [spawnError, ...stderrTail.slice(-6), totals.isError ? totals.finalText : null].filter(Boolean).join("\n");
      const error =
        status === "failed"
          ? (explainFailure(provider.id, `${tail} ${totals.finalText ?? ""}`) ?? (tail || `The agent exited with code ${code}.`))
          : stopped === "timeout"
            ? `Stopped after ${settings.runTimeoutMinutes} minutes (the time limit in Settings).`
            : null;
      if (status === "failed" && error) services.runs.addEvent(run.id, "error", error);

      services.questions.expireForRun(run.id);
      if (task.campaignId) {
        services.campaigns.releaseApplying(task.campaignId, "The agent stopped before finishing this application.");
      }
      const finished = services.runs.finish(run.id, {
        status,
        exitCode: code,
        summary: totals.finalText,
        error,
        costUsd: totals.costUsd,
        inputTokens: totals.inputTokens || null,
        outputTokens: totals.outputTokens || null,
      });
      this.active = null;
      this.emit("changed", null);
      this.emit("finished", finished);
    });

    return run;
  }

  stop(reason: "user" | "timeout" = "user"): void {
    const active = this.active;
    if (!active || active.stopReason) return;
    active.stopReason = reason;
    this.deps.services.runs.addEvent(
      active.runId,
      "warning",
      reason === "timeout" ? "Stopping: the run went over its time limit." : "Stopping: you pressed Stop.",
    );
    killTree(active.child);
  }
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (WINDOWS) {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, 5000).unref();
}
