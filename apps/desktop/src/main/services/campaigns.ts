// Campaigns and their jobs. Every rule the agent must not break is enforced here, not in the
// prompts: approval, the daily limit, per-campaign caps, pausing and duplicate applications.
// Adapted from JobPilot's campaign service and apply guard (https://github.com/suxrobgm/jobpilot, MIT).
import { createHash } from "node:crypto";
import { badRequest, conflict, forbidden, HttpError, notFound, tooManyRequests } from "../../core/errors";
import { findFuzzyDuplicate } from "../../core/duplicates/applied-duplicates";
import { canonicalizeJobUrl } from "../../core/duplicates/job-url";
import {
  addCampaignJobSchema,
  CAMPAIGN_JOB_STATUSES,
  CAMPAIGN_JOB_TERMINAL_OUTCOMES,
  CAMPAIGN_SOURCES,
  CAMPAIGN_STATUSES,
  type CampaignActor,
  type CampaignConfig,
  campaignConfigSchema,
  type CampaignJobStatus,
  campaignJobResultSchema,
  type CampaignSource,
  type CampaignStatus,
  campaignStatusCommandSchema,
  createCampaignSchema,
  patchCampaignJobSchema,
} from "../../core/schemas/campaign";
import { hostOf } from "../../core/url";
import type { ApplicationService } from "./applications";
import { newId, paginate, parseJson, type ServiceContext } from "./context";
import type { SettingsService } from "./profile";
import type { ResumeService } from "./resumes";
import type { CampaignJob, CampaignSummary, Campaign } from "../../shared/types";
export type { CampaignJob, CampaignSummary, Campaign };

interface CampaignRow {
  id: string;
  query: string;
  source: CampaignSource;
  status: CampaignStatus;
  status_reason: string | null;
  config: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface JobRow {
  campaign_id: string;
  key: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  type: string | null;
  url: string;
  board: string | null;
  match_score: number | null;
  match_reason: string | null;
  status: CampaignJobStatus;
  description: string | null;
  brief: string | null;
  fail_reason: string | null;
  skip_reason: string | null;
  retry_notes: string | null;
  approved_by: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}




const ACTIVE: readonly CampaignJobStatus[] = ["queued", "pending", "approved", "applying", "needs_user"];
const isTerminal = (status: CampaignJobStatus) =>
  (CAMPAIGN_JOB_TERMINAL_OUTCOMES as readonly string[]).includes(status);

export class AlreadyAppliedError extends HttpError {
  constructor(
    message: string,
    /** The skip reason the job is recorded with, e.g. "Already applied (url)". */
    readonly reason: string,
  ) {
    super("CONFLICT", message, 409);
    this.name = "AlreadyAppliedError";
  }
}

export class CampaignService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly settings: SettingsService,
    private readonly resumes: ResumeService,
    private readonly applications: ApplicationService,
  ) {}

  // ── campaigns ──────────────────────────────────────────────────────────

  create(input: unknown): Campaign {
    const body = createCampaignSchema.parse(input);
    const settings = this.settings.get();
    const config: CampaignConfig = campaignConfigSchema.parse({
      ...body.config,
      resumeId: body.config.resumeId ?? this.resumes.primaryId() ?? undefined,
      minScore: body.config.minScore ?? settings.minMatchScore,
      maxApplications: body.config.maxApplications ?? settings.maxApplicationsPerCampaign ?? undefined,
    });
    if (config.resumeId) this.resumes.get(config.resumeId);

    const id = newId();
    const now = this.ctx.now().toISOString();
    this.ctx.db.tx(() => {
      this.ctx.db.run(
        "INSERT INTO campaigns (id, query, source, status, config, created_by, created_at, updated_at) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?)",
        id,
        body.query,
        body.source,
        JSON.stringify(config),
        body.createdBy,
        now,
        now,
      );
      (body.urls ?? []).forEach((url, index) => {
        const host = hostOf(url) ?? "link";
        this.ctx.db.run(
          "INSERT OR IGNORE INTO jobs (campaign_id, key, title, company, url, board, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
          id,
          `link-${index + 1}-${shortHash(url)}`,
          `Job at ${host}`,
          host,
          url,
          host,
          now,
          now,
        );
      });
    });
    this.ctx.events.changed("campaigns");
    return this.get(id);
  }

  list(filter: { status?: string; source?: string; jobStatus?: string; page?: number; limit?: number } = {}) {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status && (CAMPAIGN_STATUSES as readonly string[]).includes(filter.status)) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.source && (CAMPAIGN_SOURCES as readonly string[]).includes(filter.source)) {
      where.push("source = ?");
      params.push(filter.source);
    }
    if (filter.jobStatus && (CAMPAIGN_JOB_STATUSES as readonly string[]).includes(filter.jobStatus)) {
      where.push("EXISTS (SELECT 1 FROM jobs j WHERE j.campaign_id = campaigns.id AND j.status = ?)");
      params.push(filter.jobStatus);
    }
    const rows = this.ctx.db.all<CampaignRow>(
      `SELECT * FROM campaigns ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`,
      ...params,
    );
    return paginate(rows.map((r) => this.map(r)), filter.page, filter.limit ?? 50);
  }

  get(id: string): Campaign {
    return this.map(this.row(id));
  }

  /**
   * Status commands from the agent or the user. A paused campaign is the user's to resume: the
   * agent may pause, complete or fail, but can't un-pause what the user stopped.
   */
  setStatus(id: string, input: unknown, actor: CampaignActor): Campaign {
    const campaign = this.row(id);
    const body = campaignStatusCommandSchema.parse({ ...(input as object), actor });
    if (actor === "agent" && campaign.status === "paused" && body.status === "in_progress") {
      throw forbidden("The user paused this campaign. Only the user can resume it.");
    }
    const now = this.ctx.now().toISOString();
    const finished = body.status === "completed" || body.status === "failed" ? now : null;
    this.ctx.db.run(
      "UPDATE campaigns SET status = ?, status_reason = ?, updated_at = ?, finished_at = ? WHERE id = ?",
      body.status,
      body.reason ?? null,
      now,
      finished,
      id,
    );
    this.ctx.events.changed("campaigns");
    return this.get(id);
  }

  updateConfig(id: string, patch: unknown): Campaign {
    const campaign = this.get(id);
    const config = campaignConfigSchema.parse({ ...campaign.config, ...(patch as object) });
    this.ctx.db.run(
      "UPDATE campaigns SET config = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(config),
      this.ctx.now().toISOString(),
      id,
    );
    this.ctx.events.changed("campaigns");
    return this.get(id);
  }

  remove(id: string): void {
    this.row(id);
    if (this.ctx.db.get("SELECT 1 FROM jobs WHERE campaign_id = ? AND status = 'applying'", id)) {
      throw conflict("A job in this campaign is being applied to right now. Stop the agent first.");
    }
    this.ctx.db.run("DELETE FROM campaigns WHERE id = ?", id);
    this.ctx.events.changed("campaigns");
  }

  // ── jobs ───────────────────────────────────────────────────────────────

  jobs(id: string, filter: { status?: string; page?: number; limit?: number } = {}) {
    this.row(id);
    const statuses = (filter.status ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => (CAMPAIGN_JOB_STATUSES as readonly string[]).includes(s));
    const rows = this.ctx.db.all<JobRow>(
      `SELECT * FROM jobs WHERE campaign_id = ? ${
        statuses.length ? `AND status IN (${statuses.map(() => "?").join(",")})` : ""
      } ORDER BY COALESCE(match_score, -1) DESC, created_at`,
      id,
      ...statuses,
    );
    return paginate(rows.map(mapJob), filter.page, filter.limit ?? 100);
  }

  job(id: string, key: string): CampaignJob {
    return mapJob(this.jobRow(id, key));
  }

  /** The agent saves what it found. Jobs start `queued` or `pending`; approval comes separately. */
  addJob(id: string, input: unknown): CampaignJob {
    this.row(id);
    const body = addCampaignJobSchema.parse(input);
    const status = body.status ?? "pending";
    if (status !== "queued" && status !== "pending") {
      throw badRequest(
        `Add jobs as "pending", then PATCH status "applying" to apply. That step checks approval and limits.`,
      );
    }
    if (this.ctx.db.get("SELECT 1 FROM jobs WHERE campaign_id = ? AND key = ?", id, body.key)) {
      throw conflict(`Job "${body.key}" is already in this campaign.`);
    }
    const now = this.ctx.now().toISOString();
    this.ctx.db.run(
      "INSERT INTO jobs (campaign_id, key, title, company, location, salary, type, url, board, match_score, match_reason, status, description, brief, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      body.key,
      body.title,
      body.company,
      body.location ?? null,
      body.salary ?? null,
      body.type ?? null,
      body.url,
      body.board ?? hostOf(body.url),
      body.matchScore ?? null,
      body.matchReason ?? null,
      status,
      body.description ?? null,
      body.brief ?? null,
      now,
      now,
    );
    this.touch(id);
    return this.job(id, body.key);
  }

  /** Field updates and non-terminal moves from the agent. Moving into `applying` runs the guard. */
  patchJob(id: string, key: string, input: unknown): CampaignJob {
    const job = this.jobRow(id, key);
    const body = patchCampaignJobSchema.parse(input);
    if (isTerminal(job.status)) throw conflict(`Job already finished with outcome ${job.status}.`);

    const fields: [string, unknown][] = [];
    const set = (column: string, value: unknown) => fields.push([column, value]);
    if (body.title !== undefined) set("title", body.title);
    if (body.company !== undefined) set("company", body.company);
    if (body.location !== undefined) set("location", body.location);
    if (body.salary !== undefined) set("salary", body.salary);
    if (body.type !== undefined) set("type", body.type);
    if (body.board !== undefined) set("board", body.board);
    if (body.retryNotes !== undefined) set("retry_notes", body.retryNotes);
    if (body.matchScore !== undefined) set("match_score", body.matchScore);
    if (body.matchReason !== undefined) set("match_reason", body.matchReason);
    if (body.description !== undefined) set("description", body.description);
    if (body.brief !== undefined) set("brief", body.brief);

    if (fields.length) this.updateJob(id, key, fields);
    const target = body.status;
    if (target && target !== job.status) {
      try {
        this.ctx.db.tx(() => this.moveByAgent(this.row(id), this.jobRow(id, key), target));
      } catch (error) {
        // A duplicate is a verdict, not a transient failure: record the skip so the job isn't
        // offered again, then tell the agent.
        if (error instanceof AlreadyAppliedError) {
          this.updateJob(id, key, [
            ["status", "skipped"],
            ["skip_reason", error.reason],
          ]);
          this.touch(id);
        }
        throw error;
      }
    }
    this.touch(id);
    return this.job(id, key);
  }

  /**
   * One terminal outcome per job, idempotent. `applied` creates the application record and links
   * the CV variant and cover letter that went with it.
   */
  writeResult(id: string, key: string, input: unknown) {
    const campaign = this.row(id);
    const job = this.jobRow(id, key);
    const body = campaignJobResultSchema.parse(input);
    if (isTerminal(job.status)) {
      if (job.status !== body.outcome) throw conflict(`Job already finished with outcome ${job.status}.`);
      return { job: mapJob(job), application: null, changed: false };
    }

    const now = this.ctx.now().toISOString();
    let application = null;
    this.ctx.db.tx(() => {
      this.updateJob(id, key, [
        ["status", body.outcome],
        ["applied_at", body.outcome === "applied" ? body.appliedAt ?? now : null],
        ["fail_reason", body.outcome === "failed" ? body.failReason : null],
        ["skip_reason", body.outcome === "skipped" ? body.skipReason : null],
        ["retry_notes", body.retryNotes ?? job.retry_notes],
        ["match_score", body.matchScore ?? job.match_score],
      ]);
      if (body.outcome === "applied") {
        const submitted = this.resumes.resolveSubmitted(body.resumeId, body.resumeVariantId);
        application = this.applications.recordFromCampaign({
          url: job.url,
          title: job.title,
          company: job.company,
          location: job.location,
          board: job.board,
          source: campaign.source,
          campaignId: id,
          jobKey: key,
          matchScore: body.matchScore ?? job.match_score,
          matchReason: job.match_reason,
          appliedAt: body.appliedAt ?? now,
          resumeId: submitted.resumeId,
          resumeVariantId: submitted.variantId,
          // Applying is where approval and limits are checked. A job that skipped that step still
          // gets recorded — the form was sent — but flagged so the user can see it happened.
          unchecked: job.status !== "applying",
        });
        if (submitted.variantId) this.resumes.linkVariantToApplication(submitted.variantId, (application as { id: string }).id);
      }
    });
    this.touch(id);
    return { job: this.job(id, key), application, changed: true };
  }

  // ── user actions (from the app window) ─────────────────────────────────

  approveJobs(id: string, keys: string[]): number {
    this.row(id);
    let changed = 0;
    this.ctx.db.tx(() => {
      for (const key of keys) {
        const job = this.ctx.db.get<JobRow>("SELECT * FROM jobs WHERE campaign_id = ? AND key = ?", id, key);
        if (!job || job.status === "applying" || job.status === "applied" || job.status === "approved") continue;
        this.updateJob(id, key, [
          ["status", "approved"],
          ["approved_by", "user"],
          ["skip_reason", null],
          ["fail_reason", null],
        ]);
        changed++;
      }
    });
    this.touch(id);
    return changed;
  }

  skipJobs(id: string, keys: string[], reason = "Skipped by you"): number {
    this.row(id);
    let changed = 0;
    this.ctx.db.tx(() => {
      for (const key of keys) {
        const job = this.ctx.db.get<JobRow>("SELECT * FROM jobs WHERE campaign_id = ? AND key = ?", id, key);
        if (!job || isTerminal(job.status) || job.status === "applying") continue;
        this.updateJob(id, key, [
          ["status", "skipped"],
          ["skip_reason", reason],
        ]);
        changed++;
      }
    });
    this.touch(id);
    return changed;
  }

  /** Puts jobs the agent abandoned mid-apply back where a later run can pick them up. */
  releaseApplying(id: string | null, reason: string): number {
    const rows = this.ctx.db.all<JobRow>(
      `SELECT * FROM jobs WHERE status = 'applying' ${id ? "AND campaign_id = ?" : ""}`,
      ...(id ? [id] : []),
    );
    for (const job of rows) {
      this.updateJob(job.campaign_id, job.key, [
        ["status", job.approved_by ? "approved" : "pending"],
        ["retry_notes", reason],
      ]);
    }
    if (rows.length) this.ctx.events.changed("campaigns");
    return rows.length;
  }

  /** How many more applications today allows, counting jobs mid-apply. */
  remainingToday(): number {
    const limit = this.settings.get().dailyApplicationLimit;
    const applying = this.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status = 'applying'")?.n ?? 0;
    return Math.max(0, limit - this.applications.appliedToday() - applying);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private moveByAgent(campaign: CampaignRow, job: JobRow, to: CampaignJobStatus): void {
    const settings = this.settings.get();
    const score = job.match_score;
    const autoOk = settings.approvalMode === "auto" && score !== null && score >= settings.autoApplyThreshold;

    switch (to) {
      case "pending":
        if (!["queued", "needs_user", "approved"].includes(job.status)) {
          throw conflict(`Can't move a ${job.status} job back to pending.`);
        }
        this.updateJob(campaign.id, job.key, [["status", "pending"]]);
        return;
      case "needs_user":
        this.updateJob(campaign.id, job.key, [["status", "needs_user"]]);
        return;
      case "approved":
        if (!autoOk) throw forbidden(this.approvalMessage(settings.approvalMode, score, settings.autoApplyThreshold));
        this.updateJob(campaign.id, job.key, [
          ["status", "approved"],
          ["approved_by", "auto"],
        ]);
        return;
      case "applying":
        this.guardApplying(campaign, job, autoOk);
        this.updateJob(campaign.id, job.key, [
          ["status", "applying"],
          ["approved_by", job.approved_by ?? "auto"],
        ]);
        return;
      case "queued":
        throw badRequest("Jobs can't be moved back to queued.");
    }
  }

  private approvalMessage(mode: string, score: number | null, threshold: number): string {
    if (mode === "approve") {
      return "Approve-first mode: the user approves jobs in the app before anything is sent. Leave this job pending and move on.";
    }
    if (score === null) return "This job has no match score, so it can't be auto-sent. Score it first or leave it pending.";
    return `Below the auto-send score (${score} < ${threshold}). Leave it pending for the user to approve.`;
  }

  private guardApplying(campaign: CampaignRow, job: JobRow, autoOk: boolean): void {
    if (campaign.status === "paused") {
      throw conflict(`The campaign is paused${campaign.status_reason ? ` (${campaign.status_reason})` : ""}. Stop applying.`);
    }
    if (campaign.status !== "in_progress") throw conflict(`The campaign is ${campaign.status}. Stop applying.`);

    const approved = job.status === "approved" || (job.status === "needs_user" && job.approved_by !== null);
    if (!approved && !autoOk) {
      const settings = this.settings.get();
      throw forbidden(this.approvalMessage(settings.approvalMode, job.match_score, settings.autoApplyThreshold));
    }

    const limit = this.settings.get().dailyApplicationLimit;
    if (this.remainingToday() <= 0) {
      throw tooManyRequests(
        `Daily limit reached (${limit} applications). Stop applying; the rest can go tomorrow. The user can change the limit in Settings.`,
      );
    }

    const config = parseJson<CampaignConfig>(campaign.config, {});
    if (config.maxApplications) {
      const applied =
        this.ctx.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM jobs WHERE campaign_id = ? AND status IN ('applied', 'applying')",
          campaign.id,
        )?.n ?? 0;
      if (applied >= config.maxApplications) {
        throw conflict(`This campaign's limit of ${config.maxApplications} applications is reached. Stop applying.`);
      }
    }

    // An apply in progress elsewhere for the same posting: refuse, it may still fail.
    const others = this.ctx.db.all<JobRow>(
      "SELECT * FROM jobs WHERE status = 'applying' AND NOT (campaign_id = ? AND key = ?)",
      campaign.id,
      job.key,
    );
    const canonical = canonicalizeJobUrl(job.url);
    const sibling =
      others.find((o) => canonicalizeJobUrl(o.url) === canonical) ??
      others.find(
        (o) =>
          findFuzzyDuplicate(
            { title: job.title, company: job.company },
            [{ id: "x", url: o.url, title: o.title, company: o.company, appliedAt: new Date() }],
          ) !== null,
      );
    if (sibling) {
      throw conflict(
        `Already applying: another run holds "${sibling.title}" at ${sibling.company}. Record this job as skipped with reason "Already applied (in-flight)".`,
      );
    }

    const duplicate = this.applications.findDuplicate({ url: job.url, title: job.title, company: job.company });
    if (duplicate) {
      const reason = `Already applied (${duplicate.kind})`;
      const day = duplicate.application.appliedAt.slice(0, 10);
      throw new AlreadyAppliedError(
        `${reason}: you applied to "${duplicate.application.title}" at ${duplicate.application.company} on ${day}. The job has been recorded as skipped; do not apply again.`,
        reason,
      );
    }
  }

  private updateJob(campaignId: string, key: string, fields: [string, unknown][]): void {
    const now = this.ctx.now().toISOString();
    const assignments = fields.map(([column]) => `${column} = ?`).join(", ");
    this.ctx.db.run(
      `UPDATE jobs SET ${assignments}, updated_at = ? WHERE campaign_id = ? AND key = ?`,
      ...(fields.map(([, value]) => (value === undefined ? null : value)) as (string | number | null)[]),
      now,
      campaignId,
      key,
    );
  }

  private touch(id: string): void {
    this.ctx.db.run("UPDATE campaigns SET updated_at = ? WHERE id = ?", this.ctx.now().toISOString(), id);
    this.ctx.events.changed("campaigns");
  }

  private row(id: string): CampaignRow {
    const row = this.ctx.db.get<CampaignRow>("SELECT * FROM campaigns WHERE id = ?", id);
    if (!row) throw notFound("Campaign not found");
    return row;
  }

  private jobRow(id: string, key: string): JobRow {
    const row = this.ctx.db.get<JobRow>("SELECT * FROM jobs WHERE campaign_id = ? AND key = ?", id, key);
    if (!row) throw notFound(`Job "${key}" not found in this campaign`);
    return row;
  }

  private summary(row: CampaignRow): CampaignSummary {
    const byStatus = Object.fromEntries(CAMPAIGN_JOB_STATUSES.map((s) => [s, 0])) as Record<CampaignJobStatus, number>;
    for (const r of this.ctx.db.all<{ status: CampaignJobStatus; n: number }>(
      "SELECT status, COUNT(*) AS n FROM jobs WHERE campaign_id = ? GROUP BY status",
      row.id,
    )) {
      byStatus[r.status] = r.n;
    }
    const minScore = parseJson<CampaignConfig>(row.config, {}).minScore ?? this.settings.get().minMatchScore;
    const qualified =
      this.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE campaign_id = ? AND match_score >= ?", row.id, minScore)?.n ?? 0;
    return {
      totalFound: Object.values(byStatus).reduce((a, b) => a + b, 0),
      qualified,
      applied: byStatus.applied,
      failed: byStatus.failed,
      skipped: byStatus.skipped,
      remaining: ACTIVE.reduce((n, s) => n + byStatus[s], 0),
      awaitingApproval: byStatus.pending,
      approved: byStatus.approved,
      byStatus,
    };
  }

  private map(row: CampaignRow): Campaign {
    return {
      id: row.id,
      campaignId: row.id,
      query: row.query,
      source: row.source,
      status: row.status,
      statusReason: row.status_reason,
      config: parseJson<CampaignConfig>(row.config, {}),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      summary: this.summary(row),
    };
  }
}

function mapJob(row: JobRow): CampaignJob {
  return {
    campaignId: row.campaign_id,
    key: row.key,
    title: row.title,
    company: row.company,
    location: row.location,
    salary: row.salary,
    type: row.type,
    url: row.url,
    board: row.board,
    matchScore: row.match_score,
    matchReason: row.match_reason,
    status: row.status,
    description: row.description,
    brief: row.brief,
    failReason: row.fail_reason,
    skipReason: row.skip_reason,
    retryNotes: row.retry_notes,
    approvedBy: row.approved_by,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}
