// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License.
// The tailor request body and the audit trail stored with each variant.
import { z } from "zod";

const bulletRewriteSchema = z.object({ original: z.string(), tailored: z.string() });

const entryRewriteAuditSchema = z.object({
  entryIndex: z.number().int(),
  company: z.string(),
  bullets: z.array(bulletRewriteSchema),
});

export type EntryRewriteAudit = z.infer<typeof entryRewriteAuditSchema>;

const structureAuditSchema = z.object({
  merged: z.array(
    z.object({ company: z.string(), absorbed: z.array(z.string()), start: z.string(), end: z.string() }),
  ),
  dropped: z.array(z.string()),
  promoted: z.array(
    z.object({ company: z.string(), projects: z.array(z.string()), start: z.string(), end: z.string() }),
  ),
  reordered: z.boolean(),
  retitled: z.array(z.object({ company: z.string(), from: z.string(), to: z.string() })),
  /** Soft, non-blocking review notes. */
  flags: z.array(z.string()),
});

export type StructureAudit = z.infer<typeof structureAuditSchema>;

/** Stored with a variant. `structure` only on variants that restructured. */
export const variantRewriteAuditSchema = z.object({
  experience: z.array(entryRewriteAuditSchema),
  structure: structureAuditSchema.optional(),
});

export type VariantRewriteAudit = z.infer<typeof variantRewriteAuditSchema>;

/** Every index refers to the base resume, so a plan never simulates intermediate states. */
const resumeStructureSchema = z.object({
  entryOrder: z.array(z.number().int().min(0)).optional(),
  dropEntries: z.array(z.number().int().min(0)).optional(),
  mergeEntries: z
    .array(
      z.object({
        into: z.number().int().min(0),
        from: z.array(z.number().int().min(0)).min(1),
        company: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
      }),
    )
    .optional(),
  projectOrder: z.array(z.number().int().min(0)).optional(),
  promoteProjects: z
    .object({
      projects: z.array(z.number().int().min(0)).min(1),
      company: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
    })
    .optional(),
});

export type StructurePlan = z.infer<typeof resumeStructureSchema>;

export const tailorResumeSchema = z.object({
  label: z.string().min(1),
  jobUrl: z.url().optional().nullable(),
  summary: z.string().optional(),
  headline: z.string().optional(),
  emphasizedTech: z.array(z.string()).optional(),
  jobKeywords: z.array(z.string()).optional(),
  diffNotes: z.string().optional().nullable(),
  maxBulletsPerEntry: z.number().int().min(1).max(20).optional(),
  structure: resumeStructureSchema.optional(),
  bulletRewrites: z
    .array(
      z.object({
        entryIndex: z.number().int().min(0),
        bullets: z
          .array(z.object({ original: z.string().min(1), tailored: z.string().min(1) }))
          .min(1),
      }),
    )
    .optional(),
});

export type TailorVariantBody = z.infer<typeof tailorResumeSchema>;
