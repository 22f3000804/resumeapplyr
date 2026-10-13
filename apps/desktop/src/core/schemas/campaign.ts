// Adapted from JobPilot's campaign contracts (https://github.com/suxrobgm/jobpilot), MIT License.
// Dropped: networking campaigns and the pilot. Ids are app-generated strings.
import { z } from "zod";
import { cleanReplacementChars } from "../text";

const reasonText = z.string().max(2000).transform(cleanReplacementChars);

/** The agent's job brief, as JSON text. Blank drops to undefined; anything else must be an object. */
const jobBrief = z
  .string()
  .refine((value) => {
    if (value.trim() === "") return true;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, "brief must be a JSON object.")
  .transform((value) => value.trim() || undefined);

export const CAMPAIGN_STATUSES = ["in_progress", "paused", "completed", "failed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** `search`: find and score only. `auto_apply`: find, score and apply where allowed. `apply`: pasted links. */
export const CAMPAIGN_SOURCES = ["search", "auto_apply", "apply"] as const;
export type CampaignSource = (typeof CAMPAIGN_SOURCES)[number];

export const CAMPAIGN_ACTORS = ["user", "agent"] as const;
export type CampaignActor = (typeof CAMPAIGN_ACTORS)[number];

export const CAMPAIGN_JOB_STATUSES = [
  "queued", // a pasted link nobody has visited yet
  "pending", // found and scored, waiting for a decision
  "approved",
  "applying",
  "applied",
  "failed",
  "skipped",
  "needs_user", // parked until the user answers a question
] as const;
export type CampaignJobStatus = (typeof CAMPAIGN_JOB_STATUSES)[number];

export const CAMPAIGN_JOB_TERMINAL_OUTCOMES = ["applied", "failed", "skipped"] as const;
export const CAMPAIGN_JOB_ACTIVE_STATUSES = [
  "queued",
  "pending",
  "approved",
  "applying",
  "needs_user",
] as const;

export const campaignConfigSchema = z.object({
  board: z.string().trim().toLowerCase().min(1).optional(),
  resumeId: z.string().min(1).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  maxApplications: z.number().int().min(1).max(500).optional(),
  /** Absent = unlimited: search runs until the board is exhausted. */
  maxJobs: z.number().int().min(1).max(1000).optional(),
});
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;

export const MAX_APPLY_URLS = 50;

export const createCampaignSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    source: z.enum(CAMPAIGN_SOURCES),
    config: campaignConfigSchema.default({}),
    urls: z.array(z.url()).min(1).max(MAX_APPLY_URLS).optional(),
    createdBy: z.enum(CAMPAIGN_ACTORS).default("user"),
  })
  .refine((v) => v.source === "apply" || !!v.config.board, {
    message: "Pick a job board for search and auto-apply campaigns.",
    path: ["config", "board"],
  })
  .refine((v) => v.source !== "apply" || (v.urls?.length ?? 0) > 0, {
    message: "Paste at least one job link.",
    path: ["urls"],
  })
  .refine((v) => !v.urls || v.source === "apply", {
    message: "Links are only for apply-to-links campaigns.",
    path: ["urls"],
  });
export type CreateCampaignInput = z.input<typeof createCampaignSchema>;

export const campaignStatusCommandSchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES),
  actor: z.enum(CAMPAIGN_ACTORS).default("agent"),
  reason: z.string().trim().min(1).max(300).transform(cleanReplacementChars).optional(),
});

export const addCampaignJobSchema = z.object({
  key: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  location: z.string().max(300).optional().nullable(),
  salary: z.string().max(200).optional().nullable(),
  type: z.string().max(100).optional().nullable(),
  url: z.url(),
  board: z.string().max(200).optional().nullable(),
  matchScore: z.number().int().min(0).max(100).optional().nullable(),
  matchReason: reasonText.optional().nullable(),
  status: z.enum(CAMPAIGN_JOB_ACTIVE_STATUSES).optional(),
  description: z.string().max(60000).optional().nullable(),
  brief: jobBrief.optional().nullable(),
});
export type AddCampaignJobInput = z.infer<typeof addCampaignJobSchema>;

export const patchCampaignJobSchema = z.object({
  status: z.enum(CAMPAIGN_JOB_ACTIVE_STATUSES).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  company: z.string().trim().min(1).max(300).optional(),
  location: z.string().max(300).optional().nullable(),
  salary: z.string().max(200).optional().nullable(),
  type: z.string().max(100).optional().nullable(),
  board: z.string().max(200).optional().nullable(),
  retryNotes: reasonText.optional().nullable(),
  matchScore: z.number().int().min(0).max(100).optional().nullable(),
  matchReason: reasonText.optional().nullable(),
  description: z.string().max(60000).optional().nullable(),
  brief: jobBrief.optional().nullable(),
});
export type PatchCampaignJobInput = z.infer<typeof patchCampaignJobSchema>;

export const campaignJobResultSchema = z
  .object({
    outcome: z.enum(CAMPAIGN_JOB_TERMINAL_OUTCOMES),
    appliedAt: z.iso.datetime({ offset: true }).optional(),
    failReason: z.string().trim().min(1).max(1000).transform(cleanReplacementChars).optional(),
    skipReason: z.string().trim().min(1).max(1000).transform(cleanReplacementChars).optional(),
    retryNotes: reasonText.optional().nullable(),
    matchScore: z.number().int().min(0).max(100).optional(),
    resumeId: z.string().min(1).optional(),
    resumeVariantId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      (v.outcome !== "applied" || !!v.appliedAt) &&
      (v.outcome !== "failed" || !!v.failReason) &&
      (v.outcome !== "skipped" || !!v.skipReason),
    { message: "applied requires appliedAt; failed requires failReason; skipped requires skipReason." },
  );
export type CampaignJobResultInput = z.infer<typeof campaignJobResultSchema>;
