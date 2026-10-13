import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppPaths } from "./services/context";

export function resolvePaths(root: string, agentDir: string): AppPaths {
  const workspace = join(root, "agent-workspace");
  return {
    root,
    db: join(root, "resumeapplyr.db"),
    resumes: join(root, "cvs"),
    browserProfile: join(root, "browser-profile"),
    agentWorkspace: workspace,
    runs: join(workspace, "runs"),
    agentDir,
  };
}

export function ensureDirs(paths: AppPaths): void {
  for (const dir of [paths.root, paths.resumes, paths.browserProfile, paths.agentWorkspace, paths.runs]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Run folders hold page snapshots and tailored PDFs; two weeks is plenty to look back. */
export function pruneRunFolders(paths: AppPaths, maxAgeDays = 14): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(paths.runs)) {
    const dir = join(paths.runs, name);
    try {
      if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
    } catch {
      // In use or already gone.
    }
  }
}
