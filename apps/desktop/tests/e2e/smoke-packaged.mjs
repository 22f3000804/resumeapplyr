// Smoke test for an installed or unpacked build: it starts, finds its bundled agent plugin, and
// renders without errors. Usage:
//   node tests/e2e/smoke-packaged.mjs release/<version>/linux-unpacked/resumeapplyr
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const executablePath = process.argv[2];
if (!executablePath) {
  console.error("usage: node tests/e2e/smoke-packaged.mjs <path to the built app's executable>");
  process.exit(2);
}

const userData = mkdtempSync(join(tmpdir(), "resumeapplyr-smoke-"));
const args = process.platform === "linux" && (process.getuid?.() === 0 || process.env.CI) ? ["--no-sandbox"] : [];
const env = { ...process.env, RESUMEAPPLYR_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath, args, env, timeout: 60_000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.getByRole("heading", { name: "Today", level: 1 }).waitFor({ timeout: 30_000 });

  const bundled = await app.evaluate(({ app: electronApp }) => {
    const fs = process.getBuiltinModule("node:fs");
    const path = process.getBuiltinModule("node:path");
    const agent = path.join(process.resourcesPath, "agent");
    return {
      packaged: electronApp.isPackaged,
      skill: fs.existsSync(path.join(agent, "skills", "search", "SKILL.md")),
      cli: fs.existsSync(path.join(agent, "bin", "api.mjs")),
      plugin: fs.existsSync(path.join(agent, ".claude-plugin", "plugin.json")),
    };
  });
  assert.deepEqual(bundled, { packaged: true, skill: true, cli: true, plugin: true }, "the agent plugin ships beside the app");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Settings/ }).click();
  await page.getByRole("heading", { name: "AI tool" }).waitFor();
  await page.getByRole("heading", { name: "Claude Code", level: 3 }).waitFor({ timeout: 30_000 });
  assert.deepEqual(errors, [], "the window logged no errors");
  console.log("Packaged app started, found its agent plugin and rendered without errors.");
} finally {
  await app.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}
