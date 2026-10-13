// Finds a command on PATH the way the agent process will see it, and works out how to start it
// without a shell. On Windows, npm installs CLIs as .cmd shims, and running those through cmd.exe
// means a second round of argument parsing that mangles quotes in values; reading the shim and
// starting `node <script>` (or the .exe it points at) avoids that.
// The PATH search follows JobPilot's ExecutablePath (https://github.com/suxrobgm/jobpilot, MIT).
import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

const WINDOWS = process.platform === "win32";
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export interface Launch {
  /** The file to spawn. */
  command: string;
  /** Arguments that go before the caller's own (the script, for a node shim). */
  prefixArgs: string[];
  /** Needs cmd.exe after all: the caller must quote for it. */
  viaCmd: boolean;
  /** The path PATH resolved to, for display. */
  resolved: string;
}

/** The environment's PATH, whatever case Windows stored the key in. */
export function pathOf(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  return (key ? env[key] : undefined) ?? "";
}

/** A copy of `env` with `dir` at the front of PATH, keeping the original key's casing. */
export function withPathPrefix(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const current = env[key] ?? "";
  return { ...env, [key]: current ? `${dir}${delimiter}${current}` : dir };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!command) return null;
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return isFile(command) ? command : null;
  }
  const extKey = Object.keys(env).find((k) => k.toUpperCase() === "PATHEXT");
  const exts = WINDOWS
    ? (extKey ? env[extKey] : DEFAULT_PATHEXT)!
        .split(";")
        .filter((e) => e.startsWith("."))
        .map((e) => e.toLowerCase())
    : [];
  // A real executable first, then shims: only the former starts without an interpreter.
  const candidates = WINDOWS
    ? [`${command}.exe`, ...exts.filter((e) => e !== ".exe").map((e) => command + e), command]
    : [command];

  for (const raw of pathOf(env).split(delimiter)) {
    const dir = raw.trim().replace(/^"|"$/g, "");
    if (!dir) continue;
    for (const candidate of candidates) {
      const full = join(dir, candidate);
      if (isFile(full)) return full;
    }
  }
  return null;
}

/** What an npm cmd-shim runs: `"%dp0%\node_modules\pkg\cli.js" %*` or an .exe. */
export function readCmdShim(shimPath: string): { kind: "node" | "exe"; target: string } | null {
  let text: string;
  try {
    text = readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const match = /"%(?:~?dp0%?)\\?([^"%]+?\.(?:js|cjs|mjs|exe))"\s*%\*/i.exec(text);
  if (!match) return null;
  // The shim writes Windows separators; splitting them out lets join() use the platform's own.
  const target = join(dirname(shimPath), ...match[1].split(/[\\/]+/).filter(Boolean));
  if (!existsSync(target)) return null;
  return { kind: extname(target).toLowerCase() === ".exe" ? "exe" : "node", target };
}

export function resolveLaunch(command: string, env: NodeJS.ProcessEnv = process.env): Launch | null {
  const resolved = findOnPath(command, env);
  if (!resolved) return null;
  if (!WINDOWS || !/\.(cmd|bat)$/i.test(resolved)) {
    return { command: resolved, prefixArgs: [], viaCmd: false, resolved };
  }
  const shim = readCmdShim(resolved);
  if (shim?.kind === "exe") return { command: shim.target, prefixArgs: [], viaCmd: false, resolved };
  if (shim?.kind === "node") {
    const node = findOnPath("node", env);
    if (node) return { command: node, prefixArgs: [shim.target], viaCmd: false, resolved };
  }
  return { command: env.ComSpec ?? "cmd.exe", prefixArgs: ["/d", "/s", "/c"], viaCmd: true, resolved };
}

/**
 * One command line for cmd.exe /s /c, used only when a shim couldn't be read. Every argument is
 * quoted, and cmd's metacharacters are escaped with ^ so they reach the program literally.
 */
export function cmdLine(resolved: string, args: string[]): string {
  const quote = (arg: string) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
  const escapeMeta = (s: string) => s.replace(/([()%!^"<>&|])/g, "^$1");
  return `"${[resolved, ...args].map((a) => escapeMeta(quote(a))).join(" ")}"`;
}
