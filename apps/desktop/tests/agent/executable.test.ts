import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cmdLine, findOnPath, pathOf, readCmdShim, withPathPrefix } from "../../src/main/agent/executable";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "resumeapplyr-shim-"));
  mkdirSync(join(dir, "node_modules", "@anthropic-ai", "claude-code"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"), "");
  mkdirSync(join(dir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"), "");
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "native.exe"), "");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text.replace(/\n/g, "\r\n"));
  return path;
};

describe("readCmdShim", () => {
  it("reads the script out of a current npm shim", () => {
    const shim = write(
      "claude.cmd",
      `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
`,
    );
    expect(readCmdShim(shim)).toEqual({ kind: "node", target: join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js") });
  });

  it("reads the older npm shim, skipping the bundled node.exe", () => {
    const shim = write(
      "codex.cmd",
      `@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*
)
`,
    );
    expect(readCmdShim(shim)).toEqual({ kind: "node", target: join(dir, "node_modules", "@openai", "codex", "bin", "codex.js") });
  });

  it("recognises a shim that starts a native executable", () => {
    const shim = write("native.cmd", `@"%~dp0\\tools\\native.exe" %*\n`);
    expect(readCmdShim(shim)).toEqual({ kind: "exe", target: join(dir, "tools", "native.exe") });
  });

  it("gives up when the target is missing or the file isn't a shim", () => {
    expect(readCmdShim(write("gone.cmd", `@"%~dp0\\node_modules\\gone\\cli.js" %*\n`))).toBeNull();
    expect(readCmdShim(write("plain.cmd", "@echo hello\n"))).toBeNull();
    expect(readCmdShim(join(dir, "missing.cmd"))).toBeNull();
  });
});

describe("cmdLine", () => {
  it("quotes every argument and escapes cmd's metacharacters", () => {
    const line = cmdLine("C:\\npm\\claude.cmd", ["-p", 'say "hi" & exit', "100%"]);
    expect(line.startsWith('"') && line.endsWith('"')).toBe(true);
    expect(line).toContain('^"C:\\npm\\claude.cmd^"');
    expect(line).toContain("^&");
    expect(line).toContain('\\^"hi\\^"');
    expect(line).toContain("100^%");
    expect(line).not.toMatch(/[^^]&/);
  });
});

describe("PATH helpers", () => {
  it("keeps the PATH key's casing when prefixing", () => {
    const env = withPathPrefix({ Path: "C:\\Windows" }, "C:\\agent\\bin");
    expect(Object.keys(env)).toEqual(["Path"]);
    expect(pathOf(env).startsWith("C:\\agent\\bin")).toBe(true);
  });

  it.skipIf(process.platform === "win32")("finds an executable on PATH", () => {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "fake-tool"), "#!/bin/sh\n");
    chmodSync(join(bin, "fake-tool"), 0o755);
    expect(findOnPath("fake-tool", { PATH: `/nonexistent:${bin}` })).toBe(join(bin, "fake-tool"));
    expect(findOnPath("not-there", { PATH: bin })).toBeNull();
  });
});
