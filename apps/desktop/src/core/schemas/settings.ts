import { z } from "zod";

/** Auto-apply threshold when none is set; also the fit scorer's fallback. */
export const DEFAULT_MIN_MATCH_SCORE = 60;

export const PROVIDERS = ["claude", "codex"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** Browsers the Playwright MCP server can drive with a persistent profile. */
export const BROWSER_CHANNELS = ["chrome", "msedge"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

/**
 * `approve`: the agent finds and scores jobs, and only jobs the user approves get applied to.
 * `auto`: the agent may also apply on its own to jobs scoring at or above `autoApplyThreshold`.
 */
export const APPROVAL_MODES = ["approve", "auto"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const settingsSchema = z.object({
  provider: z.enum(PROVIDERS).default("claude"),
  /** Blank = the provider's default (Sonnet for Claude Code). */
  model: z.string().trim().max(100).default(""),
  /** The main process defaults this to Edge on Windows, where it is always installed. */
  browserChannel: z.enum(BROWSER_CHANNELS).default("chrome"),
  approvalMode: z.enum(APPROVAL_MODES).default("approve"),
  autoApplyThreshold: z.number().int().min(0).max(100).default(80),
  minMatchScore: z.number().int().min(0).max(100).default(DEFAULT_MIN_MATCH_SCORE),
  dailyApplicationLimit: z.number().int().min(1).max(200).default(25),
  maxApplicationsPerCampaign: z.number().int().min(1).max(500).nullable().default(null),
  defaultStartDate: z.string().trim().min(1).max(100).default("2 weeks notice"),
  paperSize: z.enum(["A4", "Letter"]).default("A4"),
  runTimeoutMinutes: z.number().int().min(5).max(720).default(180),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const settingsPatchSchema = settingsSchema.partial();
