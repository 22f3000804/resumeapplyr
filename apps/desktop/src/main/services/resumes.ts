import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { badRequest, conflict, notFound } from "../../core/errors";
import { findProfileMismatches } from "../../core/resume/consistency";
import {
  EMPTY_RESUME_DATA,
  isProtectedVariantLabel,
  type ProfileMismatch,
  type ResumeData,
  resumeDataSchema,
  SUGGESTED_REWRITE_LABEL,
} from "../../core/schemas/resume";
import { buildTailoredVariant } from "../../core/tailoring/build-variant";
import { tailorResumeSchema, type VariantRewriteAudit } from "../../core/tailoring/schema";
import { z } from "zod";
import { renderResumeHtml } from "../pdf/templates";
import { newId, parseJson, type ServiceContext } from "./context";
import type { ProfileService, SettingsService } from "./profile";
import type { ResumeSummary, ResumeDetail, VariantSummary, VariantDetail } from "../../shared/types";
export type { ResumeSummary, ResumeDetail, VariantSummary, VariantDetail };

/** Uploads bigger than this are almost certainly not a CV. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

interface ResumeRow {
  id: string;
  label: string;
  source_filename: string | null;
  source_mime: string | null;
  content: string | null;
  version: number;
  is_primary: number;
  created_at: string;
  updated_at: string;
}

interface VariantRow {
  id: string;
  resume_id: string;
  label: string;
  job_url: string | null;
  application_id: string | null;
  content: string;
  diff_notes: string | null;
  rewrites: string | null;
  created_at: string;
  updated_at: string;
}





const updateResumeSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    content: resumeDataSchema.optional(),
  })
  .refine((v) => v.label !== undefined || v.content !== undefined, "Send label or content.");

const createVariantSchema = z.object({
  label: z.string().trim().min(1).max(200),
  jobUrl: z.url().optional().nullable(),
  content: resumeDataSchema,
  diffNotes: z.string().max(5000).optional().nullable(),
});

export class ResumeService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly profile: ProfileService,
    private readonly settings: SettingsService,
  ) {}

  list(): ResumeSummary[] {
    const counts = new Map(
      this.ctx.db
        .all<{ resume_id: string; n: number }>("SELECT resume_id, COUNT(*) AS n FROM resume_variants GROUP BY resume_id")
        .map((r) => [r.resume_id, r.n]),
    );
    return this.ctx.db
      .all<ResumeRow>("SELECT * FROM resumes ORDER BY is_primary DESC, updated_at DESC")
      .map((row) => this.summary(row, counts.get(row.id) ?? 0));
  }

  primaryId(): string | null {
    return this.ctx.db.get<{ id: string }>("SELECT id FROM resumes WHERE is_primary = 1")?.id ?? null;
  }

  get(id: string): ResumeDetail {
    const row = this.row(id);
    const variantCount =
      this.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM resume_variants WHERE resume_id = ?", id)?.n ?? 0;
    const content = row.content ? resumeDataSchema.parse(parseJson(row.content, {})) : null;
    const profile = this.profile.get();
    const detail: ResumeDetail = {
      ...this.summary(row, variantCount),
      sourceAbsolutePath: this.sourcePath(row),
      sourceMimeType: row.source_mime,
      content,
      profileMismatches: content
        ? findProfileMismatches(content.basics, {
            city: profile.city || null,
            state: profile.state || null,
            contactEmail: profile.contactEmail || null,
            phone: profile.phone || null,
            linkedin: profile.linkedin || null,
            github: profile.github || null,
            website: profile.website || null,
          })
        : [],
      createdAt: row.created_at,
    };
    return detail;
  }

  /** Copies a PDF into the app's folder and registers it. The first CV becomes the primary. */
  importFile(filePath: string): ResumeDetail {
    if (extname(filePath).toLowerCase() !== ".pdf") throw badRequest("Upload your CV as a PDF.");
    const size = statSync(filePath).size;
    if (size > MAX_SOURCE_BYTES) throw badRequest("That PDF is over 15 MB. Is it the right file?");
    const head = readFileSync(filePath).subarray(0, 5).toString("latin1");
    if (head !== "%PDF-") throw badRequest("That file isn't a PDF.");

    const id = newId();
    mkdirSync(this.ctx.paths.resumes, { recursive: true });
    const stored = `${id}.pdf`;
    copyFileSync(filePath, join(this.ctx.paths.resumes, stored));
    const now = this.ctx.now().toISOString();
    const label = basename(filePath, extname(filePath)).slice(0, 120) || "My CV";
    const first = this.list().length === 0;
    this.ctx.db.run(
      "INSERT INTO resumes (id, label, source_filename, source_mime, content, version, is_primary, created_at, updated_at) VALUES (?, ?, ?, 'application/pdf', NULL, 0, ?, ?, ?)",
      id,
      label,
      stored,
      first ? 1 : 0,
      now,
      now,
    );
    this.ctx.events.changed("resumes");
    return this.get(id);
  }

  /** A CV typed into the editor rather than uploaded. */
  createBlank(label = "My CV"): ResumeDetail {
    const id = newId();
    const now = this.ctx.now().toISOString();
    const profile = this.profile.get();
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    const content: ResumeData = {
      ...EMPTY_RESUME_DATA,
      basics: {
        name,
        email: profile.contactEmail || undefined,
        phone: profile.phone || undefined,
        location: [profile.city, profile.country].filter(Boolean).join(", ") || undefined,
        linkedin: profile.linkedin || undefined,
        github: profile.github || undefined,
        website: profile.website || undefined,
      },
    };
    const first = this.list().length === 0;
    this.ctx.db.run(
      "INSERT INTO resumes (id, label, source_filename, source_mime, content, version, is_primary, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, 1, ?, ?, ?)",
      id,
      label,
      JSON.stringify(content),
      first ? 1 : 0,
      now,
      now,
    );
    this.ctx.events.changed("resumes");
    return this.get(id);
  }

  update(id: string, input: unknown): ResumeDetail {
    const row = this.row(id);
    const patch = updateResumeSchema.parse(input);
    const now = this.ctx.now().toISOString();
    if (patch.label !== undefined) {
      this.ctx.db.run("UPDATE resumes SET label = ?, updated_at = ? WHERE id = ?", patch.label, now, id);
    }
    if (patch.content !== undefined) {
      this.ctx.db.run(
        "UPDATE resumes SET content = ?, version = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(patch.content),
        row.version + 1,
        now,
        id,
      );
      this.profile.prefillFromResume(patch.content.basics);
    }
    this.ctx.events.changed("resumes");
    return this.get(id);
  }

  setPrimary(id: string): void {
    this.row(id);
    this.ctx.db.tx(() => {
      this.ctx.db.run("UPDATE resumes SET is_primary = 0");
      this.ctx.db.run("UPDATE resumes SET is_primary = 1 WHERE id = ?", id);
    });
    this.ctx.events.changed("resumes");
  }

  remove(id: string): void {
    const row = this.row(id);
    this.ctx.db.run("DELETE FROM resumes WHERE id = ?", id);
    const source = this.sourcePath(row);
    if (source) rmSync(source, { force: true });
    if (row.is_primary === 1) {
      const next = this.ctx.db.get<{ id: string }>("SELECT id FROM resumes ORDER BY updated_at DESC LIMIT 1");
      if (next) this.ctx.db.run("UPDATE resumes SET is_primary = 1 WHERE id = ?", next.id);
    }
    this.ctx.events.changed("resumes");
  }

  /** The source PDF's bytes, for the app to show the original. */
  sourceBytes(id: string): Buffer {
    const path = this.sourcePath(this.row(id));
    if (!path || !existsSync(path)) throw notFound("This CV has no uploaded PDF.");
    return readFileSync(path);
  }

  variants(resumeId: string): VariantSummary[] {
    this.row(resumeId);
    return this.ctx.db
      .all<VariantRow>("SELECT * FROM resume_variants WHERE resume_id = ? ORDER BY created_at DESC", resumeId)
      .map((r) => this.variantSummary(r));
  }

  variant(id: string): VariantDetail {
    const row = this.ctx.db.get<VariantRow>("SELECT * FROM resume_variants WHERE id = ?", id);
    if (!row) throw notFound("Variant not found");
    const base = this.row(row.resume_id);
    return {
      ...this.variantSummary(row),
      resumeLabel: base.label,
      content: resumeDataSchema.parse(parseJson(row.content, {})),
      rewrites: parseJson<VariantRewriteAudit | null>(row.rewrites, null),
    };
  }

  /**
   * Saves a variant written by the agent. A "Suggested rewrite" replaces any earlier suggestion for
   * the same CV, so the user only ever has one to accept or discard.
   */
  createVariant(resumeId: string, input: unknown): VariantDetail {
    this.row(resumeId);
    const body = createVariantSchema.parse(input);
    const now = this.ctx.now().toISOString();
    const id = newId();
    this.ctx.db.tx(() => {
      if (body.label.startsWith(SUGGESTED_REWRITE_LABEL)) {
        this.ctx.db.run(
          "DELETE FROM resume_variants WHERE resume_id = ? AND label LIKE ?",
          resumeId,
          `${SUGGESTED_REWRITE_LABEL}%`,
        );
      }
      this.ctx.db.run(
        "INSERT INTO resume_variants (id, resume_id, label, job_url, application_id, content, diff_notes, rewrites, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)",
        id,
        resumeId,
        body.label,
        body.jobUrl ?? null,
        JSON.stringify(body.content),
        body.diffNotes ?? null,
        now,
        now,
      );
    });
    this.ctx.events.changed("resumes");
    return this.variant(id);
  }

  /**
   * A per-job copy of a base CV. The checks that keep it honest run here, not in the agent: no new
   * employer, date range, number or technology, and no stock phrasing. A failed check is a 422.
   */
  tailor(resumeId: string, input: unknown) {
    const base = this.get(resumeId);
    if (!base.content) {
      throw conflict("This CV has no structured content yet. Run extract-resume on it first.");
    }
    const body = tailorResumeSchema.parse(input);
    const built = buildTailoredVariant(base.content, body);
    const now = this.ctx.now().toISOString();
    const id = newId();
    this.ctx.db.run(
      "INSERT INTO resume_variants (id, resume_id, label, job_url, application_id, content, diff_notes, rewrites, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)",
      id,
      resumeId,
      body.label,
      body.jobUrl ?? null,
      JSON.stringify(built.content),
      body.diffNotes ?? null,
      built.audit ? JSON.stringify(built.audit) : null,
      now,
      now,
    );
    this.ctx.events.changed("resumes");
    return { id, pdfUrl: `/api/resumes/variants/${id}/pdf`, rewordedBullets: built.rewordedBullets, flags: built.flags };
  }

  /** Copies a variant's content onto its base CV and deletes the variant, in one step. */
  acceptVariant(variantId: string): ResumeDetail {
    const variant = this.variant(variantId);
    const base = this.row(variant.resumeId);
    this.ctx.db.tx(() => {
      this.ctx.db.run(
        "UPDATE resumes SET content = ?, version = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(variant.content),
        base.version + 1,
        this.ctx.now().toISOString(),
        base.id,
      );
      this.ctx.db.run("DELETE FROM resume_variants WHERE id = ?", variantId);
    });
    this.ctx.events.changed("resumes");
    return this.get(base.id);
  }

  removeVariant(id: string): void {
    this.ctx.db.run("DELETE FROM resume_variants WHERE id = ?", id);
    this.ctx.events.changed("resumes");
  }

  /** Every variant the reuse scorer may consider (suggestions are not tailored for any job). */
  reusableVariants(resumeId: string): VariantSummary[] {
    return this.variants(resumeId).filter((v) => !isProtectedVariantLabel(v.label));
  }

  resumeHtml(id: string): string {
    const detail = this.get(id);
    return renderResumeHtml(detail.content ?? EMPTY_RESUME_DATA, this.settings.get().paperSize);
  }

  variantHtml(id: string): string {
    return renderResumeHtml(this.variant(id).content, this.settings.get().paperSize);
  }

  /** Renders the structured content; a CV that has none yet sends its uploaded PDF unchanged. */
  async resumePdf(id: string): Promise<Buffer> {
    const detail = this.get(id);
    if (!detail.content) return this.sourceBytes(id);
    return this.ctx.pdf.render(renderResumeHtml(detail.content, this.settings.get().paperSize), this.settings.get().paperSize);
  }

  async variantPdf(id: string): Promise<Buffer> {
    const paper = this.settings.get().paperSize;
    return this.ctx.pdf.render(renderResumeHtml(this.variant(id).content, paper), paper);
  }

  linkVariantToApplication(variantId: string, applicationId: string): void {
    this.ctx.db.run(
      "UPDATE resume_variants SET application_id = ? WHERE id = ? AND application_id IS NULL",
      applicationId,
      variantId,
    );
  }

  /** The id pair an application should record; anything that doesn't exist is dropped. */
  resolveSubmitted(resumeId?: string, variantId?: string): { resumeId: string | null; variantId: string | null } {
    if (variantId) {
      const row = this.ctx.db.get<{ id: string; resume_id: string }>(
        "SELECT id, resume_id FROM resume_variants WHERE id = ?",
        variantId,
      );
      if (row) return { resumeId: row.resume_id, variantId: row.id };
    }
    if (resumeId && this.ctx.db.get("SELECT id FROM resumes WHERE id = ?", resumeId)) {
      return { resumeId, variantId: null };
    }
    return { resumeId: null, variantId: null };
  }

  private row(id: string): ResumeRow {
    const row = this.ctx.db.get<ResumeRow>("SELECT * FROM resumes WHERE id = ?", id);
    if (!row) throw notFound("CV not found");
    return row;
  }

  private sourcePath(row: ResumeRow): string | null {
    return row.source_filename ? join(this.ctx.paths.resumes, row.source_filename) : null;
  }

  private summary(row: ResumeRow, variantCount: number): ResumeSummary {
    return {
      id: row.id,
      label: row.label,
      sourceFilename: row.source_filename,
      hasData: row.content !== null,
      variantCount,
      isPrimary: row.is_primary === 1,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  private variantSummary(row: VariantRow): VariantSummary {
    return {
      id: row.id,
      resumeId: row.resume_id,
      label: row.label,
      jobUrl: row.job_url,
      applicationId: row.application_id,
      diffNotes: row.diff_notes,
      isSuggestion: isProtectedVariantLabel(row.label),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
