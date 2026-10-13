// The IPC surface between the window and the main process. The main process implements every
// method; the window calls them through the preload bridge. Type imports only.
import type { CreateQuestionInput } from "../core/schemas/application";
import type { CampaignStatus, CreateCampaignInput } from "../core/schemas/campaign";
import type { Profile } from "../core/schemas/profile";
import type { ResumeData } from "../core/schemas/resume";
import type { ProviderId, Settings } from "../core/schemas/settings";
import type {
  ActiveRun,
  AgentEvent,
  AgentRun,
  Application,
  ApplicationEvent,
  Board,
  Campaign,
  CampaignJob,
  CoverLetter,
  ProviderStatus,
  Question,
  ResumeDetail,
  ResumeSummary,
  VariantDetail,
  VariantSummary,
} from "./types";

export interface Paged<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface AppInfo {
  version: string;
  dataDir: string;
  platform: string;
}

export interface AgentSetup {
  provider: ProviderId;
  providers: ProviderStatus[];
  node: { installed: boolean; version: string | null };
  checkedAt: string;
}

export interface ApplicationStats {
  total: number;
  byStatus: Record<string, number>;
  today: number;
  thisWeek: number;
  dailyLimit: number;
  remainingToday: number;
}

export interface SavedAnswer {
  key: string;
  value: string;
  updatedAt: string;
}

export interface LetterSummary {
  id: string;
  jobTitle: string | null;
  company: string | null;
  applicationId: string | null;
  createdAt: string;
}

export type PreviewTarget = { resumeId: string } | { variantId: string } | { content: ResumeData };

export interface RpcMethods {
  "app.info": () => AppInfo;

  "profile.get": () => Profile;
  "profile.save": (profile: Profile) => Profile;
  "settings.get": () => Settings;
  "settings.update": (patch: Partial<Settings>) => Settings;

  "boards.list": () => Board[];
  "boards.add": (input: { domain: string; name: string; searchUrl?: string | null }) => Board;
  "boards.remove": (domain: string) => void;

  "resumes.list": () => ResumeSummary[];
  "resumes.get": (id: string) => ResumeDetail;
  "resumes.import": () => ResumeDetail | null;
  "resumes.createBlank": () => ResumeDetail;
  "resumes.update": (id: string, patch: { label?: string; content?: ResumeData }) => ResumeDetail;
  "resumes.setPrimary": (id: string) => void;
  "resumes.remove": (id: string) => void;
  "resumes.variants": (id: string) => VariantSummary[];
  "resumes.variant": (id: string) => VariantDetail;
  "resumes.acceptVariant": (id: string) => ResumeDetail;
  "resumes.removeVariant": (id: string) => void;
  "resumes.previewHtml": (target: PreviewTarget) => string;
  "resumes.exportPdf": (target: { resumeId: string } | { variantId: string }) => string | null;
  "resumes.openSource": (id: string) => void;

  "campaigns.list": () => Paged<Campaign>;
  "campaigns.get": (id: string) => Campaign;
  "campaigns.create": (input: CreateCampaignInput, start: boolean) => Campaign;
  /** `status` takes one status or a comma-separated list; pages hold 100 jobs. */
  "campaigns.jobs": (id: string, filter?: { status?: string; page?: number }) => Paged<CampaignJob>;
  "campaigns.approve": (id: string, keys: string[]) => number;
  "campaigns.skip": (id: string, keys: string[]) => number;
  "campaigns.setStatus": (id: string, status: CampaignStatus, reason?: string) => Campaign;
  "campaigns.remove": (id: string) => void;
  "campaigns.run": (id: string) => AgentRun;
  "campaigns.applyApproved": (id: string) => AgentRun;

  "applications.list": (filter?: { status?: string; search?: string; page?: number }) => Paged<Application>;
  "applications.get": (id: string) => Application & { events: ApplicationEvent[] };
  "applications.stats": () => ApplicationStats;
  "applications.update": (id: string, patch: { status?: string; notes?: string; note?: string }) => Application;
  "applications.create": (input: { url: string; title: string; company: string; location?: string; notes?: string }) => Application;
  "applications.remove": (id: string) => void;

  "questions.list": (status?: string) => Question[];
  "questions.answer": (id: string, answer: string, remember: boolean) => Question;
  "questions.dismiss": (id: string) => Question;
  /** For the app's own "ask" flows; the agent uses the HTTP API. */
  "questions.create": (input: CreateQuestionInput) => Question;

  "answers.list": () => SavedAnswer[];
  "answers.upsert": (key: string, value: string) => { key: string; value: string };
  "answers.remove": (key: string) => void;

  "letters.list": () => Paged<LetterSummary>;
  "letters.get": (id: string) => CoverLetter;
  "letters.exportPdf": (id: string) => string | null;

  "agent.setup": (refresh: boolean) => AgentSetup;
  "agent.current": () => ActiveRun | null;
  "agent.runs": () => AgentRun[];
  "agent.run": (id: string) => AgentRun;
  "agent.events": (runId: string, afterId: number) => AgentEvent[];
  "agent.stop": () => void;
  "agent.extractResume": (resumeId: string, force: boolean) => AgentRun;
  "agent.reviewResume": (resumeId: string) => AgentRun;
  "agent.coverLetter": (input: { jobUrl?: string; jobText?: string; company?: string }) => AgentRun;

  "browser.signIn": (url: string) => void;
  "browser.close": () => void;
  "browser.status": () => { open: boolean };
  "browser.resetProfile": () => void;

  "shell.openExternal": (url: string) => void;
  "shell.openDataFolder": () => void;
}

export type RpcMethod = keyof RpcMethods;

export interface RpcError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError };

/** Pushed from the main process: data changed, agent activity, runner state, a new question. */
export type PushChannel = "changed" | "run-event" | "runner" | "question";

export interface Bridge {
  call<M extends RpcMethod>(method: M, ...args: Parameters<RpcMethods[M]>): Promise<RpcResult<Awaited<ReturnType<RpcMethods[M]>>>>;
  on(channel: PushChannel, listener: (payload: unknown) => void): () => void;
}
