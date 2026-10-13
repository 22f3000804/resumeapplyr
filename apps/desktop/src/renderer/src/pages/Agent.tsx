import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentRun } from "../../../shared/types";
import { useAgent, useProvider } from "../agent";
import { call, usePush, useRpc } from "../api";
import { RunStatusTag } from "../components/status";
import { Button, Checkbox, Empty, ErrorNote, Loading, PageHeader, Section, useAction, useTick } from "../components/ui";
import { duration, formatDateTime, formatTime, relative, SKILL_LABEL } from "../format";
import { href, Link } from "../router";

export function AgentPage({ runId }: { runId?: string }) {
  const runs = useRpc("agent.runs", [], ["runs"]);
  const { current } = useAgent();
  const provider = useProvider();
  useTick(30_000);
  const selected = runId ?? current?.runId;

  return (
    <>
      <PageHeader
        title="Agent"
        lead={
          provider.status?.installed
            ? `Runs on ${provider.name}${provider.status.version ? ` ${provider.status.version}` : ""} with your own subscription, one task at a time. Everything it does is listed here.`
            : "Runs on Claude Code or Codex with your own subscription, one task at a time. Everything it does is listed here."
        }
        back={runId ? { href: href("agent"), label: "All runs" } : undefined}
      />
      {selected ? <RunView key={selected} runId={selected} /> : null}

      {!runId ? (
        <Section title="Past runs" description="Kept for 30 days.">
          {runs.error ? (
            <ErrorNote error={runs.error} onRetry={runs.reload} />
          ) : !runs.data ? (
            <Loading />
          ) : runs.data.length === 0 ? (
            <Empty title="Nothing yet">
              <p>Start a campaign, or ask the agent to read your CV, and its work shows up here step by step.</p>
            </Empty>
          ) : (
            <RunsTable runs={runs.data} />
          )}
        </Section>
      ) : null}
    </>
  );
}

function RunsTable({ runs }: { runs: AgentRun[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col" className="num">
              Took
            </th>
            <th scope="col" className="num">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link to={["agent", run.id]} className="primary-text">
                  {run.title}
                </Link>
                <span className="secondary-text">
                  {SKILL_LABEL[run.skill] ?? run.skill}, with {run.provider === "codex" ? "Codex" : "Claude Code"}
                </span>
              </td>
              <td>
                <RunStatusTag status={run.status} />
              </td>
              <td className="nowrap">{relative(run.startedAt)}</td>
              <td className="num nowrap">{run.status === "running" ? "…" : duration(run.startedAt, run.endedAt)}</td>
              <td className="num tnum">{run.costUsd !== null ? `$${run.costUsd.toFixed(2)}` : <span className="muted">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MAX_EVENTS = 2000;

function RunView({ runId }: { runId: string }) {
  const run = useRpc("agent.run", [runId], ["runs"]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [follow, setFollow] = useState(true);
  const lastId = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const { busy, run: act } = useAction();

  useEffect(() => {
    let cancelled = false;
    void call("agent.events", runId, 0).then(
      (initial) => {
        if (cancelled) return;
        lastId.current = initial.at(-1)?.id ?? 0;
        setEvents(initial.slice(-MAX_EVENTS));
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return () => {
      cancelled = true;
    };
  }, [runId]);

  usePush("run-event", (payload) => {
    const event = payload as AgentEvent;
    if (event.runId !== runId || event.id <= lastId.current) return;
    lastId.current = event.id;
    setEvents((prev) => [...prev, event].slice(-MAX_EVENTS));
  });

  const running = run.data?.status === "running";
  useEffect(() => {
    if (running && follow) end.current?.scrollIntoView({ block: "end" });
  }, [events.length, running, follow]);

  if (run.error) return <ErrorNote error={run.error} onRetry={run.reload} />;
  if (!run.data) return <Loading />;
  const r = run.data;
  const technical = events.filter((e) => e.kind === "stderr").length;
  const visible = showTechnical ? events : events.filter((e) => e.kind !== "stderr");

  return (
    <section className="section" aria-label="Run">
      <div className="run-head">
        <div>
          <h2 className="run-title">{r.title}</h2>
          <p className="run-meta">
            {SKILL_LABEL[r.skill] ?? r.skill}, started {formatDateTime(r.startedAt)}.{" "}
            {running ? `Running for ${duration(r.startedAt)}.` : `Took ${duration(r.startedAt, r.endedAt)}.`}
            {r.costUsd !== null ? ` Cost $${r.costUsd.toFixed(2)} of your ${r.provider === "codex" ? "Codex" : "Claude"} usage.` : ""}
          </p>
        </div>
        <div className="row">
          <RunStatusTag status={r.status} />
          {running ? (
            <Button busy={busy === "stop"} onClick={() => act("stop", () => call("agent.stop"), "Stopping the agent")}>
              Stop
            </Button>
          ) : null}
          {r.campaignId ? (
            <a className="btn btn-secondary btn-small" href={href("campaigns", r.campaignId)}>
              Open the campaign
            </a>
          ) : null}
        </div>
      </div>

      {r.error ? (
        <div className="notice notice-accent" role="alert">
          <p className="notice-title">What went wrong</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.error}</p>
        </div>
      ) : null}

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="row" style={{ gap: 20 }}>
          {technical > 0 ? (
            <Checkbox label={`Show technical output (${technical} lines)`} checked={showTechnical} onChange={setShowTechnical} />
          ) : null}
          {running ? <Checkbox label="Follow new steps" checked={follow} onChange={setFollow} /> : null}
        </div>
      </div>

      {!loaded ? (
        <Loading />
      ) : visible.length === 0 ? (
        <p className="muted">{running ? "Starting…" : "This run left no activity."}</p>
      ) : (
        <ol className="feed" aria-live={running ? "polite" : undefined} aria-relevant="additions">
          {visible.map((event) => (
            <li key={event.id} className={`ev-${event.kind}`}>
              <time dateTime={event.at}>{formatTime(event.at)}</time>
              <p className="ev-body">{describe(event)}</p>
            </li>
          ))}
        </ol>
      )}
      <div ref={end} />
      {!running && loaded ? <p className="feed-end">{endLine(r)}</p> : null}
    </section>
  );
}

function describe(event: AgentEvent): string {
  const text = event.text ?? "";
  return event.kind === "tool_error" ? `A step failed: ${text}` : text;
}

function endLine(run: AgentRun): string {
  switch (run.status) {
    case "succeeded":
      return `Finished ${relative(run.endedAt)}.`;
    case "failed":
      return `Stopped with an error ${relative(run.endedAt)}.`;
    case "stopped":
      return `Stopped ${relative(run.endedAt)}.`;
    default:
      return "";
  }
}
