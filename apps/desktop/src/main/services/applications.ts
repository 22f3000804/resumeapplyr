import { conflict, notFound } from "../../core/errors";
import {
  APPLIED_DUPLICATE_THRESHOLD,
  APPLIED_DUPLICATE_WINDOW_DAYS,
  findFuzzyDuplicate,
} from "../../core/duplicates/applied-duplicates";
import { canonicalizeJobUrl } from "../../core/duplicates/job-url";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
  createApplicationSchema,
  updateApplicationSchema,
} from "../../core/schemas/application";
import { hostOf } from "../../core/url";
import { newId, paginate, type ServiceContext, startOfToday } from "./context";
import type { Application, ApplicationEvent, AppliedMatch } from "../../shared/types";
export type { Application, ApplicationEvent, AppliedMatch };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A heavy month's worth; the fuzzy scan runs in-process, so it has to stay bounded. */
const MAX_FUZZY_CANDIDATES = 1000;

interface ApplicationRow {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  board: string | null;
  source: string;
  campaign_id: string | null;
  job_key: string | null;
  match_score: number | null;
  match_reason: string | null;
  status: ApplicationStatus;
  resume_id: string | null;
  resume_variant_id: string | null;
  notes: string | null;
  unchecked: number;
  applied_at: string;
  created_at: string;
  updated_at: string;
}




export interface ApplicationFilter {
  status?: string;
  search?: string;
  campaignId?: string;
  page?: number;
  limit?: number;
}

export class ApplicationService {
  constructor(private readonly ctx: ServiceContext) {}

  list(filter: ApplicationFilter = {}) {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status && (APPLICATION_STATUSES as readonly string[]).includes(filter.status)) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.campaignId) {
      where.push("campaign_id = ?");
      params.push(filter.campaignId);
    }
    if (filter.search) {
      where.push("(title LIKE ? OR company LIKE ?)");
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }
    const rows = this.ctx.db.all<ApplicationRow>(
      `SELECT * FROM applications ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY applied_at DESC`,
      ...params,
    );
    return paginate(rows.map((r) => this.map(r)), filter.page, filter.limit ?? 100);
  }

  get(id: string): Application & { events: ApplicationEvent[] } {
    const row = this.ctx.db.get<ApplicationRow>("SELECT * FROM applications WHERE id = ?", id);
    if (!row) throw notFound("Application not found");
    const events = this.ctx.db
      .all<{ id: number; kind: string; to_status: string | null; note: string | null; source: string; created_at: string }>(
        "SELECT * FROM application_events WHERE application_id = ? ORDER BY id",
        id,
      )
      .map((e) => ({ id: e.id, kind: e.kind, toStatus: e.to_status, note: e.note, source: e.source, createdAt: e.created_at }));
    return { ...this.map(row), events };
  }

  /**
   * Exact URL at any age, else fuzzy title + company within 30 days (older near-matches are
   * usually reposts worth applying to again). The same check guards the move into `applying`, so
   * advice and enforcement can't drift apart.
   */
  findDuplicate(lookup: { url?: string; title?: string; company?: string }): AppliedMatch | null {
    if (lookup.url) {
      const row = this.ctx.db.get<ApplicationRow>(
        "SELECT * FROM applications WHERE url = ?",
        canonicalizeJobUrl(lookup.url),
      );
      if (row) return { kind: "url", application: this.map(row) };
    }
    if (!lookup.title || !lookup.company) return null;

    const cutoff = new Date(this.ctx.now().getTime() - APPLIED_DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString();
    const candidates = this.ctx.db.all<ApplicationRow>(
      "SELECT * FROM applications WHERE applied_at >= ? ORDER BY applied_at DESC LIMIT ?",
      cutoff,
      MAX_FUZZY_CANDIDATES,
    );
    const fuzzy = findFuzzyDuplicate(
      { title: lookup.title, company: lookup.company },
      candidates.map((c) => ({ id: c.id, url: c.url, title: c.title, company: c.company, appliedAt: c.applied_at })),
      APPLIED_DUPLICATE_THRESHOLD,
    );
    if (!fuzzy) return null;
    const row = candidates.find((c) => c.id === fuzzy.candidate.id)!;
    return { kind: "fuzzy", score: fuzzy.score, application: this.map(row) };
  }

  appliedCheck(lookup: { url?: string; title?: string; company?: string }) {
    const match = this.findDuplicate(lookup);
    return match ? { applied: true, match } : { applied: false, match: null };
  }

  /** Applications sent since local midnight. The daily limit counts these plus jobs mid-apply. */
  appliedToday(): number {
    return (
      this.ctx.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM applications WHERE applied_at >= ? AND source != 'manual'",
        startOfToday(this.ctx.now()),
      )?.n ?? 0
    );
  }

  stats() {
    const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
    for (const row of this.ctx.db.all<{ status: ApplicationStatus; n: number }>(
      "SELECT status, COUNT(*) AS n FROM applications GROUP BY status",
    )) {
      byStatus[row.status] = row.n;
    }
    const weekAgo = new Date(this.ctx.now().getTime() - 7 * DAY_MS).toISOString();
    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      today: this.appliedToday(),
      thisWeek: this.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE applied_at >= ?", weekAgo)?.n ?? 0,
    };
  }

  /** An application the user sent themselves, outside the agent, so dedupe knows about it. */
  createManual(input: unknown): Application {
    const body = createApplicationSchema.parse(input);
    const url = canonicalizeJobUrl(body.url);
    if (this.ctx.db.get("SELECT id FROM applications WHERE url = ?", url)) {
      throw conflict("You already have an application for that link.");
    }
    const id = newId();
    const now = this.ctx.now().toISOString();
    const appliedAt = body.appliedAt ?? now;
    this.ctx.db.tx(() => {
      this.ctx.db.run(
        "INSERT INTO applications (id, url, title, company, location, board, source, status, notes, applied_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'manual', 'applied', ?, ?, ?, ?)",
        id,
        url,
        body.title,
        body.company,
        body.location ?? null,
        body.board ?? hostOf(body.url),
        body.notes ?? null,
        appliedAt,
        now,
        now,
      );
      this.addEvent(id, "status_change", "applied", null, "manual");
    });
    this.ctx.events.changed("applications");
    return this.get(id);
  }

  update(id: string, input: unknown): Application {
    const current = this.get(id);
    const body = updateApplicationSchema.parse(input);
    const now = this.ctx.now().toISOString();
    this.ctx.db.tx(() => {
      if (body.status && body.status !== current.status) {
        this.ctx.db.run("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?", body.status, now, id);
        this.addEvent(id, "status_change", body.status, body.note ?? null, "manual");
      } else if (body.note) {
        this.addEvent(id, "note", null, body.note, "manual");
      }
      if (body.notes !== undefined) {
        this.ctx.db.run("UPDATE applications SET notes = ?, updated_at = ? WHERE id = ?", body.notes, now, id);
      }
    });
    this.ctx.events.changed("applications");
    return this.get(id);
  }

  remove(id: string): void {
    this.ctx.db.run("DELETE FROM applications WHERE id = ?", id);
    this.ctx.events.changed("applications");
  }

  /**
   * Records a sent application from a campaign result. A repost of a link already applied to
   * reuses the row and moves its date, since the duplicate window measures from it.
   */
  recordFromCampaign(input: {
    url: string;
    title: string;
    company: string;
    location: string | null;
    board: string | null;
    source: string;
    campaignId: string;
    jobKey: string;
    matchScore: number | null;
    matchReason: string | null;
    appliedAt: string;
    resumeId: string | null;
    resumeVariantId: string | null;
    unchecked: boolean;
  }): Application {
    const url = canonicalizeJobUrl(input.url);
    const now = this.ctx.now().toISOString();
    const existing = this.ctx.db.get<{ id: string }>("SELECT id FROM applications WHERE url = ?", url);
    const id = existing?.id ?? newId();
    if (existing) {
      this.ctx.db.run(
        "UPDATE applications SET applied_at = ?, resume_id = COALESCE(?, resume_id), resume_variant_id = COALESCE(?, resume_variant_id), unchecked = MAX(unchecked, ?), updated_at = ? WHERE id = ?",
        input.appliedAt,
        input.resumeId,
        input.resumeVariantId,
        input.unchecked ? 1 : 0,
        now,
        id,
      );
    } else {
      this.ctx.db.run(
        "INSERT INTO applications (id, url, title, company, location, board, source, campaign_id, job_key, match_score, match_reason, status, resume_id, resume_variant_id, unchecked, applied_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?)",
        id,
        url,
        input.title,
        input.company,
        input.location,
        input.board,
        input.source,
        input.campaignId,
        input.jobKey,
        input.matchScore,
        input.matchReason,
        input.resumeId,
        input.resumeVariantId,
        input.unchecked ? 1 : 0,
        input.appliedAt,
        now,
        now,
      );
    }
    this.addEvent(
      id,
      "status_change",
      "applied",
      input.unchecked ? "Sent without passing the app's approval and limit checks." : null,
      "campaign",
    );
    // The letter was saved before this row existed, so link it by the URL it recorded.
    this.ctx.db.run(
      "UPDATE cover_letters SET application_id = ? WHERE application_id IS NULL AND job_url IS NOT NULL AND job_url = ?",
      id,
      input.url,
    );
    this.ctx.events.changed("applications", "letters");
    return this.get(id);
  }

  private addEvent(applicationId: string, kind: string, toStatus: string | null, note: string | null, source: string) {
    this.ctx.db.run(
      "INSERT INTO application_events (application_id, kind, to_status, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      applicationId,
      kind,
      toStatus,
      note,
      source,
      this.ctx.now().toISOString(),
    );
  }

  private map(row: ApplicationRow): Application {
    const letter = this.ctx.db.get<{ id: string }>(
      "SELECT id FROM cover_letters WHERE application_id = ? ORDER BY created_at DESC LIMIT 1",
      row.id,
    );
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      company: row.company,
      location: row.location,
      board: row.board,
      source: row.source,
      campaignId: row.campaign_id,
      jobKey: row.job_key,
      matchScore: row.match_score,
      matchReason: row.match_reason,
      status: row.status,
      resumeId: row.resume_id,
      resumeVariantId: row.resume_variant_id,
      coverLetterId: letter?.id ?? null,
      notes: row.notes,
      unchecked: row.unchecked === 1,
      appliedAt: row.applied_at,
      updatedAt: row.updated_at,
    };
  }
}
