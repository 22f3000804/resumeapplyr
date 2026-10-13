import { notFound } from "../../core/errors";
import { newId, parseJson, type ServiceContext } from "./context";
import type { RunStatus, AgentRun, AgentEventKind, AgentEvent } from "../../shared/types";
export type { RunStatus, AgentRun, AgentEventKind, AgentEvent };





interface RunRow {
  id: string;
  skill: string;
  args: string | null;
  title: string;
  provider: string;
  campaign_id: string | null;
  resume_id: string | null;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  summary: string | null;
  error: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

/** Each agent session and the activity it reported, for the Agent screen and later review. */
export class RunService {
  constructor(private readonly ctx: ServiceContext) {
    // A run can't survive an app restart; anything still marked running was cut off.
    ctx.db.run(
      "UPDATE agent_runs SET status = 'stopped', ended_at = COALESCE(ended_at, ?), error = COALESCE(error, 'The app closed while this run was going.') WHERE status = 'running'",
      ctx.now().toISOString(),
    );
    // Keep the detailed activity log for 30 days; the run rows themselves stay.
    const cutoff = new Date(ctx.now().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    ctx.db.run(
      "DELETE FROM agent_events WHERE run_id IN (SELECT id FROM agent_runs WHERE started_at < ?)",
      cutoff,
    );
  }

  create(input: { skill: string; args: string; title: string; provider: string; campaignId?: string | null; resumeId?: string | null }): AgentRun {
    const id = newId();
    this.ctx.db.run(
      "INSERT INTO agent_runs (id, skill, args, title, provider, campaign_id, resume_id, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)",
      id,
      input.skill,
      input.args,
      input.title,
      input.provider,
      input.campaignId ?? null,
      input.resumeId ?? null,
      this.ctx.now().toISOString(),
    );
    this.ctx.events.changed("runs");
    return this.get(id);
  }

  addEvent(runId: string, kind: AgentEventKind, text: string | null, data?: unknown): AgentEvent {
    const at = this.ctx.now().toISOString();
    this.ctx.db.run(
      "INSERT INTO agent_events (run_id, at, kind, text, data) VALUES (?, ?, ?, ?, ?)",
      runId,
      at,
      kind,
      text,
      data === undefined ? null : JSON.stringify(data),
    );
    const id = this.ctx.db.get<{ id: number }>("SELECT last_insert_rowid() AS id")!.id;
    const event: AgentEvent = { id, runId, at, kind, text, data: data ?? null };
    this.ctx.events.emit("run-event", event);
    return event;
  }

  finish(
    runId: string,
    result: {
      status: RunStatus;
      exitCode?: number | null;
      summary?: string | null;
      error?: string | null;
      costUsd?: number | null;
      inputTokens?: number | null;
      outputTokens?: number | null;
    },
  ): AgentRun {
    this.ctx.db.run(
      "UPDATE agent_runs SET status = ?, ended_at = ?, exit_code = ?, summary = ?, error = ?, cost_usd = ?, input_tokens = ?, output_tokens = ? WHERE id = ?",
      result.status,
      this.ctx.now().toISOString(),
      result.exitCode ?? null,
      result.summary ?? null,
      result.error ?? null,
      result.costUsd ?? null,
      result.inputTokens ?? null,
      result.outputTokens ?? null,
      runId,
    );
    this.ctx.events.changed("runs");
    return this.get(runId);
  }

  get(id: string): AgentRun {
    const row = this.ctx.db.get<RunRow>("SELECT * FROM agent_runs WHERE id = ?", id);
    if (!row) throw notFound("Run not found");
    return mapRun(row);
  }

  list(limit = 50): AgentRun[] {
    return this.ctx.db.all<RunRow>("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?", limit).map(mapRun);
  }

  events(runId: string, afterId = 0, limit = 500): AgentEvent[] {
    return this.ctx.db
      .all<{ id: number; run_id: string; at: string; kind: AgentEventKind; text: string | null; data: string | null }>(
        "SELECT * FROM agent_events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?",
        runId,
        afterId,
        limit,
      )
      .map((e) => ({ id: e.id, runId: e.run_id, at: e.at, kind: e.kind, text: e.text, data: parseJson(e.data, null) }));
  }
}

function mapRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    skill: row.skill,
    args: row.args,
    title: row.title,
    provider: row.provider,
    campaignId: row.campaign_id,
    resumeId: row.resume_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    summary: row.summary,
    error: row.error,
    costUsd: row.cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
  };
}
