import { EventEmitter } from "node:events";
import type { Db } from "../db/database";

export type Topic =
  | "profile"
  | "settings"
  | "resumes"
  | "boards"
  | "campaigns"
  | "applications"
  | "questions"
  | "answers"
  | "letters"
  | "runs";

/** Change notifications. The window refetches whatever a topic covers, like JobPilot's SSE channels. */
export class EventBus extends EventEmitter {
  changed(...topics: Topic[]): void {
    this.emit("changed", topics);
  }
}

export interface PdfRenderer {
  render(html: string, paperSize: "A4" | "Letter"): Promise<Buffer>;
}

export interface AppPaths {
  /** Everything the app writes lives under here (Electron's userData folder). */
  root: string;
  db: string;
  /** Uploaded source CVs. */
  resumes: string;
  /** The browser profile the agent drives; the user signs in to job boards here once. */
  browserProfile: string;
  /** Working folder for agent sessions (Codex needs skills copied inside it). */
  agentWorkspace: string;
  /** Per-run scratch folders. */
  runs: string;
  /** The bundled agent plugin: skills, workers, settings and the resumeapplyr-api CLI. */
  agentDir: string;
}

export interface ServiceContext {
  db: Db;
  paths: AppPaths;
  events: EventBus;
  pdf: PdfRenderer;
  now: () => Date;
}

export const newId = (): string => crypto.randomUUID();

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Page through a list the way JobPilot's API does: 1-based, at most 100 per page. */
export function paginate<T>(items: T[], page = 1, limit = 50) {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 50), 100);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / safeLimit)),
    },
  };
}

/** Midnight at the start of today, local time, as an ISO string. */
export function startOfToday(now: Date): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
