import { notFound } from "../../core/errors";
import { type FitResult, scoreFit } from "../../core/scoring/fit";
import { deriveProfileFitInputs } from "../../core/scoring/profile-fit";
import { scoreFitSchema } from "../../core/scoring/schema";
import {
  answerQuestionSchema,
  coverLetterSchema,
  createQuestionSchema,
  savedAnswerSchema,
} from "../../core/schemas/application";
import { renderCoverLetterHtml } from "../pdf/templates";
import { newId, paginate, parseJson, type ServiceContext } from "./context";
import type { ProfileService, SettingsService } from "./profile";
import type { ResumeService } from "./resumes";
import type { Question, CoverLetter } from "../../shared/types";
export type { Question, CoverLetter };

/** Deterministic keyword-overlap fit score (no LLM), from JobPilot's scoring service. */
export class ScoringService {
  constructor(
    private readonly resumes: ResumeService,
    private readonly profile: ProfileService,
    private readonly settings: SettingsService,
  ) {}

  score(input: unknown): FitResult {
    const { brief, profile, resumeId, minScore } = scoreFitSchema.parse(input);
    const baseId = resumeId ?? this.resumes.primaryId();
    let derived = { skills: [] as string[], yearsExperience: null as number | null };
    if (baseId) {
      const content = this.resumes.get(baseId).content;
      if (content) derived = deriveProfileFitInputs(content);
    }
    return scoreFit(
      brief,
      {
        skills: profile?.skills ?? derived.skills,
        yearsExperience: profile?.yearsExperience !== undefined ? profile.yearsExperience : derived.yearsExperience,
        // From the profile, never the caller: leaving the flag out must not skip the check.
        requiresSponsorship: this.profile.get().requiresSponsorship,
      },
      minScore ?? this.settings.get().minMatchScore,
    );
  }
}

interface QuestionRow {
  id: string;
  run_id: string | null;
  campaign_id: string | null;
  job_key: string | null;
  kind: string;
  question: string;
  context: string | null;
  options: string | null;
  answer_key: string | null;
  url: string | null;
  answer: string | null;
  status: "pending" | "answered" | "dismissed" | "expired";
  created_at: string;
  answered_at: string | null;
}


/**
 * How the agent reaches the user mid-run: it files a question, the app shows it (and a system
 * notification), and the agent long-polls for the answer.
 */
export class QuestionService {
  constructor(private readonly ctx: ServiceContext) {}

  create(input: unknown, runId: string | null): Question {
    const body = createQuestionSchema.parse(input);
    const id = newId();
    this.ctx.db.run(
      "INSERT INTO questions (id, run_id, campaign_id, job_key, kind, question, context, options, answer_key, url, answer, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)",
      id,
      runId,
      body.campaignId ?? null,
      body.jobKey ?? null,
      body.kind,
      body.question,
      body.context ?? null,
      body.options ? JSON.stringify(body.options) : null,
      body.answerKey ?? null,
      body.url ?? null,
      this.ctx.now().toISOString(),
    );
    const question = this.get(id);
    this.ctx.events.emit("question", question);
    this.ctx.events.changed("questions");
    return question;
  }

  get(id: string): Question {
    const row = this.ctx.db.get<QuestionRow>("SELECT * FROM questions WHERE id = ?", id);
    if (!row) throw notFound("Question not found");
    return mapQuestion(row);
  }

  list(status?: string): Question[] {
    return this.ctx.db
      .all<QuestionRow>(
        `SELECT * FROM questions ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 200`,
        ...(status ? [status] : []),
      )
      .map(mapQuestion);
  }

  answer(id: string, input: unknown, answers: AnswerService): Question {
    const question = this.get(id);
    const body = answerQuestionSchema.parse(input);
    this.ctx.db.run(
      "UPDATE questions SET answer = ?, status = 'answered', answered_at = ? WHERE id = ? AND status = 'pending'",
      body.answer,
      this.ctx.now().toISOString(),
      id,
    );
    if (body.remember && question.answerKey && body.answer) {
      answers.upsert({ key: question.answerKey, value: body.answer });
    }
    this.ctx.events.emit(`answered:${id}`);
    this.ctx.events.changed("questions");
    return this.get(id);
  }

  dismiss(id: string): Question {
    this.ctx.db.run("UPDATE questions SET status = 'dismissed', answered_at = ? WHERE id = ? AND status = 'pending'", this.ctx.now().toISOString(), id);
    this.ctx.events.emit(`answered:${id}`);
    this.ctx.events.changed("questions");
    return this.get(id);
  }

  /** Resolves when the question is answered or dismissed, or after `timeoutSeconds`. */
  wait(id: string, timeoutSeconds: number): Promise<Question> {
    const question = this.get(id);
    if (question.status !== "pending") return Promise.resolve(question);
    const timeout = Math.min(Math.max(1, timeoutSeconds), 110) * 1000;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.ctx.events.off(`answered:${id}`, done);
        resolve(this.get(id));
      };
      const timer = setTimeout(done, timeout);
      this.ctx.events.on(`answered:${id}`, done);
    });
  }

  /** Questions from a run that has ended can no longer be answered usefully. */
  expireForRun(runId: string): void {
    const pending = this.ctx.db.all<{ id: string }>("SELECT id FROM questions WHERE run_id = ? AND status = 'pending'", runId);
    this.ctx.db.run("UPDATE questions SET status = 'expired' WHERE run_id = ? AND status = 'pending'", runId);
    for (const { id } of pending) this.ctx.events.emit(`answered:${id}`);
    if (pending.length) this.ctx.events.changed("questions");
  }
}

function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    runId: row.run_id,
    campaignId: row.campaign_id,
    jobKey: row.job_key,
    kind: row.kind,
    question: row.question,
    context: row.context,
    options: parseJson<string[]>(row.options, []),
    answerKey: row.answer_key,
    url: row.url,
    answer: row.answer,
    status: row.status,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

/** Answers to reusable form questions (notice period, relocation), so they're asked once. */
export class AnswerService {
  constructor(private readonly ctx: ServiceContext) {}

  list(): { key: string; value: string; updatedAt: string }[] {
    return this.ctx.db
      .all<{ key: string; value: string; updated_at: string }>("SELECT * FROM saved_answers ORDER BY key")
      .map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
  }

  upsert(input: unknown) {
    const body = savedAnswerSchema.parse(input);
    this.ctx.db.run(
      "INSERT INTO saved_answers (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      body.key,
      body.value,
      this.ctx.now().toISOString(),
    );
    this.ctx.events.changed("answers");
    return body;
  }

  remove(key: string): void {
    this.ctx.db.run("DELETE FROM saved_answers WHERE key = ?", key);
    this.ctx.events.changed("answers");
  }
}


export class CoverLetterService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly settings: SettingsService,
  ) {}

  create(input: unknown): CoverLetter {
    const body = coverLetterSchema.parse(input);
    const id = newId();
    this.ctx.db.run(
      "INSERT INTO cover_letters (id, content, job_url, job_title, company, source, application_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
      id,
      body.content,
      body.jobUrl ?? null,
      body.jobTitle ?? null,
      body.company ?? null,
      body.source,
      this.ctx.now().toISOString(),
    );
    this.ctx.events.changed("letters");
    return this.get(id);
  }

  get(id: string): CoverLetter {
    const row = this.ctx.db.get<{
      id: string;
      content: string;
      job_url: string | null;
      job_title: string | null;
      company: string | null;
      source: string;
      application_id: string | null;
      created_at: string;
    }>("SELECT * FROM cover_letters WHERE id = ?", id);
    if (!row) throw notFound("Cover letter not found");
    return {
      id: row.id,
      content: row.content,
      jobUrl: row.job_url,
      jobTitle: row.job_title,
      company: row.company,
      source: row.source,
      applicationId: row.application_id,
      createdAt: row.created_at,
    };
  }

  /** Metadata only, newest first; fetch one by id for its text. */
  list(page = 1, limit = 20) {
    const rows = this.ctx.db.all<{ id: string; job_title: string | null; company: string | null; created_at: string; application_id: string | null }>(
      "SELECT id, job_title, company, created_at, application_id FROM cover_letters ORDER BY created_at DESC",
    );
    return paginate(
      rows.map((r) => ({ id: r.id, jobTitle: r.job_title, company: r.company, applicationId: r.application_id, createdAt: r.created_at })),
      page,
      limit,
    );
  }

  pdf(text: string): Promise<Buffer> {
    const paper = this.settings.get().paperSize;
    return this.ctx.pdf.render(renderCoverLetterHtml(text, paper), paper);
  }
}
