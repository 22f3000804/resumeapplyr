// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License.
import { z } from "zod";
import { ELIGIBILITY_RESTRICTION_KINDS } from "./eligibility";

/** Above this the brief is quoting a salary or a year, not counting experience. */
export const MAX_YEARS_EXPERIENCE = 50;

export const jobBriefSchema = z.object({
  title: z.string().optional().default(""),
  company: z.string().optional().default(""),
  location: z.string().optional(),
  salary: z.string().optional(),
  employmentType: z.string().optional(),
  remote: z.boolean().optional(),
  skills: z.array(z.string()).optional().default([]),
  requirements: z.array(z.string()).optional().default([]),
  responsibilities: z.array(z.string()).optional().default([]),
  yearsExperience: z.number().int().min(0).max(MAX_YEARS_EXPERIENCE).nullable().optional(),
  descriptionExcerpt: z.string().optional().default(""),
});

export type JobBrief = z.infer<typeof jobBriefSchema>;

export const fitProfileSchema = z.object({
  skills: z.array(z.string()).default([]),
  yearsExperience: z.number().int().min(0).max(MAX_YEARS_EXPERIENCE).nullable().default(null),
  /** From the profile; only then does the posting's work-authorization language matter. */
  requiresSponsorship: z.boolean().default(false),
});

export type FitProfile = z.infer<typeof fitProfileSchema>;

export const scoreFitSchema = z.object({
  brief: jobBriefSchema,
  profile: fitProfileSchema.partial().optional(),
  resumeId: z.string().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
});

export const fitResultSchema = z.object({
  score: z.number(),
  confidence: z.number(),
  strongMatches: z.array(z.string()),
  partialMatches: z.array(z.string()),
  gaps: z.array(z.string()),
  verdict: z.enum(["trust", "deliberate"]),
  eligibilityBlocked: z
    .object({ kind: z.enum(ELIGIBILITY_RESTRICTION_KINDS), evidence: z.string() })
    .optional(),
});
