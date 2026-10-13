// Plain-language labels and date formatting shared by every screen.
import type { ApplicationStatus } from "../../core/schemas/application";
import type { CampaignJobStatus, CampaignSource, CampaignStatus } from "../../core/schemas/campaign";
import type { RunStatus } from "../../shared/types";

export const SOURCE_LABEL: Record<CampaignSource, string> = {
  search: "Find and score",
  auto_apply: "Find and apply",
  apply: "Apply to links",
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  in_progress: "Active",
  paused: "Paused",
  completed: "Finished",
  failed: "Stopped with an error",
};

export const JOB_STATUS_LABEL: Record<CampaignJobStatus, string> = {
  queued: "Not opened yet",
  pending: "Waiting for you",
  approved: "Approved",
  applying: "Applying now",
  applied: "Applied",
  failed: "Didn't go through",
  skipped: "Skipped",
  needs_user: "Needs you",
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

export const SKILL_LABEL: Record<string, string> = {
  search: "Search",
  "auto-apply": "Search and apply",
  apply: "Apply",
  "extract-resume": "Read CV",
  "review-resume": "Review CV",
  "cover-letter": "Cover letter",
};

const DAY = 24 * 60 * 60 * 1000;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return sameDay(date, new Date()) ? `Today, ${formatTime(iso)}` : `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", then the date. */
export function relative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const ms = now.getTime() - date.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (sameDay(date, now)) return `${Math.floor(ms / (60 * 60_000))} h ago`;
  if (sameDay(date, new Date(now.getTime() - DAY))) return "yesterday";
  return formatDate(iso);
}

export function duration(startIso: string, endIso?: string | null, now = new Date()): string {
  const ms = (endIso ? new Date(endIso) : now).getTime() - new Date(startIso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function money(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount);
}
