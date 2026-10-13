// Shapes the main process returns to the window, shared by both sides of the IPC bridge.
// Only type imports here: this file is compiled for the renderer too.
import type { ApplicationStatus } from "../core/schemas/application";
import type { CampaignConfig, CampaignJobStatus, CampaignSource, CampaignStatus } from "../core/schemas/campaign";
import type { ProfileMismatch, ResumeData } from "../core/schemas/resume";
import type { ProviderId } from "../core/schemas/settings";
import type { VariantRewriteAudit } from "../core/tailoring/schema";

export interface ResumeSummary {
  id: string;
  label: string;
  sourceFilename: string | null;
  hasData: boolean;
  variantCount: number;
  isPrimary: boolean;
  version: number;
  updatedAt: string;
}

export interface ResumeDetail extends ResumeSummary {
  sourceAbsolutePath: string | null;
  sourceMimeType: string | null;
  content: ResumeData | null;
  profileMismatches: ProfileMismatch[];
  createdAt: string;
}

export interface VariantSummary {
  id: string;
  resumeId: string;
  label: string;
  jobUrl: string | null;
  applicationId: string | null;
  diffNotes: string | null;
  isSuggestion: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VariantDetail extends VariantSummary {
  resumeLabel: string;
  content: ResumeData;
  rewrites: VariantRewriteAudit | null;
}

export interface Application {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  board: string | null;
  source: string;
  campaignId: string | null;
  jobKey: string | null;
  matchScore: number | null;
  matchReason: string | null;
  status: ApplicationStatus;
  resumeId: string | null;
  resumeVariantId: string | null;
  coverLetterId: string | null;
  notes: string | null;
  /** Recorded without passing the app's approval and limit checks first. */
  unchecked: boolean;
  appliedAt: string;
  updatedAt: string;
}

export interface ApplicationEvent {
  id: number;
  kind: string;
  toStatus: string | null;
  note: string | null;
  source: string;
  createdAt: string;
}

export type AppliedMatch =
  | { kind: "url"; application: Application }
  | { kind: "fuzzy"; score: number; application: Application };

export interface CampaignJob {
  campaignId: string;
  key: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  type: string | null;
  url: string;
  board: string | null;
  matchScore: number | null;
  matchReason: string | null;
  status: CampaignJobStatus;
  description: string | null;
  brief: string | null;
  failReason: string | null;
  skipReason: string | null;
  retryNotes: string | null;
  approvedBy: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSummary {
  totalFound: number;
  qualified: number;
  applied: number;
  failed: number;
  skipped: number;
  remaining: number;
  awaitingApproval: number;
  approved: number;
  byStatus: Record<CampaignJobStatus, number>;
}

export interface Campaign {
  id: string;
  /** Same as `id`; the ported skills read `campaignId`. */
  campaignId: string;
  query: string;
  source: CampaignSource;
  status: CampaignStatus;
  statusReason: string | null;
  config: CampaignConfig;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  summary: CampaignSummary;
}

export interface Question {
  id: string;
  runId: string | null;
  campaignId: string | null;
  jobKey: string | null;
  kind: string;
  question: string;
  context: string | null;
  options: string[];
  answerKey: string | null;
  url: string | null;
  answer: string | null;
  status: "pending" | "answered" | "dismissed" | "expired";
  createdAt: string;
  answeredAt: string | null;
}

export interface CoverLetter {
  id: string;
  content: string;
  jobUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  source: string;
  applicationId: string | null;
  createdAt: string;
}

export type RunStatus = "running" | "succeeded" | "failed" | "stopped";

export interface AgentRun {
  id: string;
  skill: string;
  args: string | null;
  title: string;
  provider: string;
  campaignId: string | null;
  resumeId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  summary: string | null;
  error: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AgentEventKind = "info" | "text" | "tool" | "tool_error" | "warning" | "error" | "result" | "stderr";

export interface AgentEvent {
  id: number;
  runId: string;
  at: string;
  kind: AgentEventKind;
  text: string | null;
  data: unknown;
}

export interface Board {
  domain: string;
  name: string;
  searchUrl: string | null;
  builtin: boolean;
}

export type SkillName = "search" | "auto-apply" | "apply" | "extract-resume" | "review-resume" | "cover-letter";

export interface ActiveRun {
  runId: string;
  title: string;
  skill: SkillName;
  campaignId: string | null;
  startedAt: string;
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  /** Flags this version supports that the launch depends on. */
  missingFlags: string[];
}
