// Turns each provider's machine output into short, readable activity lines for the Agent screen.
// Claude Code: `-p --output-format stream-json --verbose`. Codex: `exec --json`.
import { basename } from "node:path";
import type { AgentEventKind } from "../services/runs";

export interface ParsedEvent {
  kind: AgentEventKind;
  text: string;
  data?: unknown;
}

export interface RunTotals {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  /** The agent's final words: Claude's `result`, or Codex's last message. */
  finalText: string | null;
  isError: boolean;
}

export interface OutputParser {
  /** One line of stdout. Returns the activity it describes (possibly none). */
  line(raw: string): ParsedEvent[];
  totals(): RunTotals;
}

const clip = (text: string, max = 240) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const BROWSER_TOOLS: Record<string, (input: Record<string, unknown>) => string> = {
  browser_navigate: (i) => `Opened ${String(i.url ?? "a page")}`,
  browser_navigate_back: () => "Went back a page",
  browser_click: (i) => `Clicked ${String(i.element ?? "an element")}`,
  browser_type: (i) => `Typed into ${String(i.element ?? "a field")}`,
  browser_fill_form: (i) => `Filled ${Array.isArray(i.fields) ? i.fields.length : "several"} form fields`,
  browser_select_option: (i) => `Chose ${Array.isArray(i.values) ? i.values.join(", ") : "an option"} in ${String(i.element ?? "a list")}`,
  browser_file_upload: () => "Uploaded a file",
  browser_snapshot: () => "Read the page",
  browser_take_screenshot: () => "Took a screenshot",
  browser_wait_for: (i) => (i.text ? `Waited for "${clip(String(i.text), 60)}"` : "Waited for the page"),
  browser_tabs: (i) => `Tabs: ${String(i.action ?? "list")}`,
  browser_press_key: (i) => `Pressed ${String(i.key ?? "a key")}`,
  browser_evaluate: () => "Ran a script on the page",
  browser_close: () => "Closed the browser",
  browser_resize: () => "Resized the browser",
};

/** A one-line description of a tool call. */
export function describeTool(name: string, input: Record<string, unknown> = {}): string {
  const tool = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/^mcp__playwright__/, "");
  if (BROWSER_TOOLS[tool]) return BROWSER_TOOLS[tool](input);
  switch (name) {
    case "Bash":
    case "PowerShell": {
      const command = String(input.command ?? "");
      const api = /resumeapplyr-api\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i.exec(command);
      return api ? `API ${api[1].toUpperCase()} ${api[2]}` : `Ran: ${clip(command, 160)}`;
    }
    case "Skill":
      return `Using the ${String(input.skill ?? input.name ?? "a")} skill`;
    case "Task":
    case "Agent":
      return `Started ${String(input.subagent_type ?? "a worker")}: ${clip(String(input.description ?? ""), 120)}`;
    case "Read":
      return `Read ${basename(String(input.file_path ?? "a file"))}`;
    case "Write":
      return `Wrote ${basename(String(input.file_path ?? "a file"))}`;
    case "Edit":
      return `Edited ${basename(String(input.file_path ?? "a file"))}`;
    case "TodoWrite":
      return "Updated its plan";
    default:
      return tool;
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

export function claudeParser(): OutputParser {
  const totals: RunTotals = { costUsd: null, inputTokens: 0, outputTokens: 0, finalText: null, isError: false };
  return {
    totals: () => totals,
    line(raw) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return raw.trim() ? [{ kind: "info", text: clip(raw) }] : [];
      }
      const out: ParsedEvent[] = [];
      switch (msg.type) {
        case "system": {
          if (msg.subtype !== "init") break;
          const servers = (msg.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
          const browser = servers.find((s) => s.name === "playwright");
          out.push({ kind: "info", text: `Session started${msg.model ? ` on ${String(msg.model)}` : ""}.` });
          if (browser && browser.status !== "connected") {
            out.push({ kind: "warning", text: `Browser tools are ${browser.status}. Check that Node.js (npx) is installed.` });
          }
          break;
        }
        case "assistant": {
          const message = msg.message as { content?: unknown[] } | undefined;
          for (const part of message?.content ?? []) {
            const p = part as { type: string; text?: string; name?: string; input?: Record<string, unknown> };
            if (p.type === "text" && p.text?.trim()) out.push({ kind: "text", text: clip(p.text, 1200) });
            if (p.type === "tool_use" && p.name) out.push({ kind: "tool", text: describeTool(p.name, p.input), data: { tool: p.name } });
          }
          break;
        }
        case "user": {
          const message = msg.message as { content?: unknown[] } | undefined;
          for (const part of message?.content ?? []) {
            const p = part as { type: string; is_error?: boolean; content?: unknown };
            if (p.type === "tool_result" && p.is_error) {
              out.push({ kind: "tool_error", text: clip(contentText(p.content) || "A tool call failed.", 400) });
            }
          }
          break;
        }
        case "result": {
          const usage = (msg.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) ?? {};
          totals.inputTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
          totals.outputTokens = usage.output_tokens ?? 0;
          totals.costUsd = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null;
          totals.isError = msg.is_error === true || (typeof msg.subtype === "string" && msg.subtype.startsWith("error"));
          totals.finalText = typeof msg.result === "string" ? msg.result : null;
          if (totals.finalText) out.push({ kind: "result", text: clip(totals.finalText, 4000) });
          else if (totals.isError) out.push({ kind: "error", text: `The agent stopped: ${String(msg.subtype ?? "error")}.` });
          break;
        }
      }
      return out;
    },
  };
}

export function codexParser(): OutputParser {
  const totals: RunTotals = { costUsd: null, inputTokens: 0, outputTokens: 0, finalText: null, isError: false };
  return {
    totals: () => totals,
    line(raw) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return raw.trim() ? [{ kind: "info", text: clip(raw) }] : [];
      }
      const out: ParsedEvent[] = [];
      const item = msg.item as Record<string, unknown> | undefined;
      switch (msg.type) {
        case "thread.started":
          out.push({ kind: "info", text: "Session started." });
          break;
        case "item.started":
          if (item?.type === "command_execution") out.push({ kind: "tool", text: describeTool("Bash", { command: item.command }) });
          if (item?.type === "mcp_tool_call") {
            out.push({ kind: "tool", text: describeTool(String(item.tool ?? ""), (item.arguments as Record<string, unknown>) ?? {}) });
          }
          break;
        case "item.completed":
          if (item?.type === "agent_message" && typeof item.text === "string") {
            totals.finalText = item.text;
            out.push({ kind: "text", text: clip(item.text, 1200) });
          }
          if (item?.type === "command_execution" && typeof item.exit_code === "number" && item.exit_code !== 0) {
            out.push({ kind: "tool_error", text: clip(String(item.aggregated_output ?? `Exited with ${item.exit_code}`), 400) });
          }
          if (item?.type === "mcp_tool_call" && item.error) {
            out.push({ kind: "tool_error", text: clip(JSON.stringify(item.error), 400) });
          }
          if (item?.type === "error") out.push({ kind: "error", text: clip(String(item.message ?? "Error")) });
          break;
        case "turn.completed": {
          const usage = (msg.usage as { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number }) ?? {};
          totals.inputTokens += usage.input_tokens ?? 0;
          totals.outputTokens += usage.output_tokens ?? 0;
          break;
        }
        case "turn.failed":
          totals.isError = true;
          out.push({ kind: "error", text: clip(String((msg.error as { message?: string })?.message ?? "The turn failed.")) });
          break;
        case "error":
          totals.isError = true;
          out.push({ kind: "error", text: clip(String(msg.message ?? "Error")) });
          break;
      }
      return out;
    },
  };
}
