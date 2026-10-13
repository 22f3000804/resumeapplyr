import { Fragment, useEffect, useMemo, useState } from "react";
import type { CampaignJobStatus } from "../../../core/schemas/campaign";
import type { Campaign, CampaignJob } from "../../../shared/types";
import { useAgent, useProvider } from "../agent";
import { call, useRpc } from "../api";
import { CampaignStatusTag, JobStatusTag } from "../components/status";
import {
  Button,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  Score,
  Segmented,
  Stat,
  Tag,
  useAction,
  useConfirm,
  useTick,
} from "../components/ui";
import { duration, formatDateTime, plural, relative, SOURCE_LABEL } from "../format";
import { href, navigate } from "../router";

type FilterKey = "waiting" | "approved" | "queued" | "applied" | "failed" | "skipped" | "all";

const FILTERS: Record<FilterKey, { label: string; statuses: CampaignJobStatus[] }> = {
  waiting: { label: "Waiting for you", statuses: ["pending", "needs_user"] },
  approved: { label: "Approved", statuses: ["approved", "applying"] },
  queued: { label: "Not opened yet", statuses: ["queued"] },
  applied: { label: "Applied", statuses: ["applied"] },
  failed: { label: "Didn't go through", statuses: ["failed"] },
  skipped: { label: "Skipped", statuses: ["skipped"] },
  all: { label: "All", statuses: [] },
};

const DECIDABLE: CampaignJobStatus[] = ["queued", "pending", "needs_user", "approved", "failed", "skipped"];

export function CampaignDetailPage({ id }: { id: string }) {
  const campaign = useRpc("campaigns.get", [id], ["campaigns", "resumes"]);
  if (campaign.error) {
    return (
      <>
        <PageHeader title="Campaign" back={{ href: href("campaigns"), label: "All campaigns" }} />
        <ErrorNote error={campaign.error} onRetry={campaign.reload} />
      </>
    );
  }
  if (!campaign.data) return <Loading />;
  return <CampaignView key={campaign.data.id} campaign={campaign.data} />;
}

function CampaignView({ campaign }: { campaign: Campaign }) {
  const settings = useRpc("settings.get", [], ["settings"]);
  const resumes = useRpc("resumes.list", [], ["resumes"]);
  const { current } = useAgent();
  const provider = useProvider();
  const confirm = useConfirm();
  const { busy, run } = useAction();
  useTick(30_000);

  const counts = campaign.summary.byStatus;
  const countFor = (key: FilterKey) =>
    key === "all" ? campaign.summary.totalFound : FILTERS[key].statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  const [chosen, setChosen] = useState<FilterKey | null>(null);
  const filter: FilterKey = chosen ?? (countFor("waiting") > 0 ? "waiting" : "all");
  const [page, setPage] = useState(1);
  const statusParam = FILTERS[filter].statuses.join(",");
  const jobs = useRpc("campaigns.jobs", [campaign.id, { status: statusParam || undefined, page }], ["campaigns"]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setSelected(new Set());
    setPage(1);
  }, [filter]);

  const s = settings.data;
  const bar = campaign.config.minScore ?? s?.minMatchScore ?? 60;
  const autoBar = s?.approvalMode === "auto" ? s.autoApplyThreshold : null;
  const thisRun = current?.campaignId === campaign.id ? current : null;
  const busyElsewhere = !!current && !thisRun;
  const canRun = provider.ready && !current && campaign.status !== "paused";
  const approvedCount = counts.approved ?? 0;
  // In auto-send mode the agent may also send waiting jobs at or above the auto-send score.
  const showApply = approvedCount > 0 || (autoBar !== null && countFor("waiting") > 0);
  const resumeLabel = resumes.data?.find((r) => r.id === campaign.config.resumeId)?.label;

  const items = jobs.data?.items ?? [];
  const selectable = items.filter((j) => DECIDABLE.includes(j.status));
  const allSelected = selectable.length > 0 && selectable.every((j) => selected.has(j.key));
  const aboveBar = useMemo(
    () => items.filter((j) => (j.status === "pending" || j.status === "needs_user") && (j.matchScore ?? -1) >= bar),
    [items, bar],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const approve = async (keys: string[]) => {
    const n = await run("approve", () => call("campaigns.approve", campaign.id, keys), (count) =>
      count === 0 ? "Those jobs were already decided." : `Approved ${plural(count, "job")}. Press “Apply to approved” to send.`,
    );
    if (n !== undefined) setSelected(new Set());
  };
  const skip = async (keys: string[]) => {
    const n = await run("skip", () => call("campaigns.skip", campaign.id, keys), (count) => `Skipped ${plural(count, "job")}.`);
    if (n !== undefined) setSelected(new Set());
  };

  const runLabel =
    campaign.source === "search" ? "Search for more" : campaign.source === "auto_apply" ? "Find and apply" : "Score the links";
  const showRun = campaign.source !== "apply" || (counts.queued ?? 0) > 0;

  const remove = async () => {
    const ok = await confirm({
      title: "Delete this campaign?",
      body: "Its job list goes. Applications already sent stay in Applications, so the agent still won't apply to them twice.",
      confirmLabel: "Delete campaign",
      danger: true,
    });
    if (!ok) return;
    const done = await run("delete", () => call("campaigns.remove", campaign.id).then(() => true), "Campaign deleted.");
    if (done) navigate("campaigns");
  };

  return (
    <>
      <PageHeader
        back={{ href: href("campaigns"), label: "All campaigns" }}
        title={campaign.query}
        lead={
          <>
            {SOURCE_LABEL[campaign.source]}
            {campaign.config.board ? ` on ${campaign.config.board}` : ""}, started {relative(campaign.createdAt)}. Keeps jobs
            scoring {bar} or more{resumeLabel ? `, starting from “${resumeLabel}”` : ""}.
            {campaign.config.maxApplications ? ` Sends at most ${campaign.config.maxApplications}.` : ""}
          </>
        }
        actions={
          <>
            <CampaignStatusTag status={campaign.status} />
            {thisRun ? (
              <Button busy={busy === "stop"} onClick={() => run("stop", () => call("agent.stop"), "Stopping the agent")}>
                Stop the agent
              </Button>
            ) : (
              <>
                {showRun ? (
                  <Button
                    variant={approvedCount > 0 ? "secondary" : "primary"}
                    disabled={!canRun}
                    busy={busy === "run"}
                    title={!canRun ? runBlockedReason(provider.ready, busyElsewhere, campaign.status === "paused") : undefined}
                    onClick={() => run("run", () => call("campaigns.run", campaign.id), "The agent is starting.")}
                  >
                    {runLabel}
                  </Button>
                ) : null}
                {showApply ? (
                  <Button
                    variant="primary"
                    disabled={!canRun}
                    busy={busy === "apply"}
                    title={!canRun ? runBlockedReason(provider.ready, busyElsewhere, campaign.status === "paused") : undefined}
                    onClick={() => run("apply", () => call("campaigns.applyApproved", campaign.id), "The agent is starting to apply.")}
                  >
                    {approvedCount > 0 ? `Apply to approved (${approvedCount})` : `Apply to jobs scoring ${autoBar}+`}
                  </Button>
                ) : null}
              </>
            )}
            {campaign.status === "paused" ? (
              <Button
                busy={busy === "resume"}
                onClick={() => run("resume", () => call("campaigns.setStatus", campaign.id, "in_progress"), "Campaign resumed.")}
              >
                Resume
              </Button>
            ) : campaign.status === "in_progress" ? (
              <Button
                busy={busy === "pause"}
                onClick={() =>
                  run("pause", () => call("campaigns.setStatus", campaign.id, "paused", "Paused by you"), "Paused. The agent won't apply until you resume.")
                }
              >
                Pause
              </Button>
            ) : null}
            <Button variant="danger" busy={busy === "delete"} onClick={remove}>
              Delete
            </Button>
          </>
        }
      />

      {thisRun ? (
        <div className="notice notice-accent">
          <p>
            <span className="notice-title">The agent is working on this campaign</span> ({duration(thisRun.startedAt)} so far).
            New jobs appear below as it finds them. <a href={href("agent", thisRun.runId)}>Watch what it's doing</a>
          </p>
        </div>
      ) : busyElsewhere ? (
        <div className="notice">
          <p>The agent is busy with “{current?.title}”. Runs go one at a time; start this one when it finishes.</p>
        </div>
      ) : !provider.ready && provider.known ? (
        <div className="notice">
          <p>
            {provider.name} isn't set up on this computer, so the agent can't run. <a href={href("settings")}>Set it up in Settings</a>
          </p>
        </div>
      ) : null}
      {campaign.statusReason && campaign.status !== "in_progress" ? (
        <div className="notice">
          <p>{campaign.statusReason}</p>
        </div>
      ) : null}

      <div className="stats" role="group" aria-label="Campaign numbers">
        <Stat value={campaign.summary.totalFound} label="Jobs found" />
        <Stat value={countFor("waiting")} label="Waiting for your decision" accent={countFor("waiting") > 0} />
        <Stat value={approvedCount} label="Approved, not sent yet" />
        <Stat value={campaign.summary.applied} label="Applied" />
      </div>

      <section className="section" aria-label="Jobs">
        <div className="toolbar">
          <Segmented
            label="Show"
            hideLabel
            value={filter}
            onChange={(value) => setChosen(value)}
            options={(Object.keys(FILTERS) as FilterKey[])
              .filter((key) => key !== "queued" || countFor("queued") > 0 || filter === "queued")
              .map((key) => ({ value: key, label: `${FILTERS[key].label} ${countFor(key)}` }))}
          />
          {filter === "waiting" && aboveBar.length > 0 ? (
            <Button busy={busy === "approve"} onClick={() => approve(aboveBar.map((j) => j.key))}>
              Approve all scoring {bar}+ ({aboveBar.length})
            </Button>
          ) : null}
        </div>

        {jobs.error ? (
          <ErrorNote error={jobs.error} onRetry={jobs.reload} />
        ) : !jobs.data ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty title={thisRun && campaign.summary.totalFound === 0 ? "Searching" : emptyTitle(filter, campaign.summary.totalFound)}>
            <p>
              {thisRun && campaign.summary.totalFound === 0
                ? "The agent is looking. Jobs appear here as it scores them, best first."
                : emptyBody(filter, campaign)}
            </p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table jobs-table">
              <thead>
                <tr>
                  <th scope="col" className="check-cell">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        disabled={selectable.length === 0}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((j) => j.key)))}
                      />
                      <span className="box" aria-hidden="true" />
                      <span className="sr-only">Select all</span>
                    </label>
                  </th>
                  <th scope="col">Score</th>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Why</th>
                  <th scope="col" className="actions-cell">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((job) => {
                  const isOpen = open === job.key;
                  const canDecide = job.status === "pending" || job.status === "needs_user" || job.status === "queued";
                  return (
                    <Fragment key={job.key}>
                      <tr className={[selected.has(job.key) ? "is-selected" : "", isOpen ? "is-open" : ""].join(" ")}>
                        <td className="check-cell">
                          {DECIDABLE.includes(job.status) ? (
                            <label className="check">
                              <input type="checkbox" checked={selected.has(job.key)} onChange={() => toggle(job.key)} />
                              <span className="box" aria-hidden="true" />
                              <span className="sr-only">Select {job.title}</span>
                            </label>
                          ) : null}
                        </td>
                        <td className="score-cell">
                          <Score value={job.matchScore} bar={bar} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="row-toggle primary-text"
                            aria-expanded={isOpen}
                            onClick={() => setOpen(isOpen ? null : job.key)}
                          >
                            {job.title}
                          </button>
                          <span className="secondary-text">
                            {[job.company, job.location, job.salary].filter(Boolean).join(", ")}
                          </span>
                        </td>
                        <td>
                          <JobStatusTag status={job.status} />
                          {job.approvedBy === "auto" && job.status !== "pending" ? (
                            <span className="secondary-text">by auto-send</span>
                          ) : null}
                        </td>
                        <td>
                          <p className="reason clamp-2">{job.failReason ?? job.skipReason ?? job.matchReason ?? ""}</p>
                        </td>
                        <td className="actions-cell">
                          {canDecide ? (
                            <div className="row" style={{ justifyContent: "flex-end" }}>
                              <Button small busy={busy === "approve"} onClick={() => approve([job.key])}>
                                Approve
                              </Button>
                              <Button small variant="ghost" busy={busy === "skip"} onClick={() => skip([job.key])}>
                                Skip
                              </Button>
                            </div>
                          ) : job.status === "failed" || job.status === "skipped" ? (
                            <Button small variant="ghost" busy={busy === "approve"} onClick={() => approve([job.key])}>
                              Try again
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="detail-row">
                          <td />
                          <td colSpan={5}>
                            <JobDetail job={job} bar={bar} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {jobs.data && jobs.data.pagination.totalPages > 1 ? (
          <div className="pager">
            <Button small disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="tnum">
              Page {jobs.data.pagination.page} of {jobs.data.pagination.totalPages}
            </span>
            <Button small disabled={page >= jobs.data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        ) : null}

        {selected.size > 0 ? (
          <div className="selection-bar" role="region" aria-label="Selected jobs">
            <span className="count">{plural(selected.size, "job")} selected</span>
            <Button variant="primary" busy={busy === "approve"} onClick={() => approve([...selected])}>
              Approve
            </Button>
            <Button busy={busy === "skip"} onClick={() => skip([...selected])}>
              Skip
            </Button>
            <Button onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        ) : null}
      </section>
    </>
  );
}

function runBlockedReason(ready: boolean, busyElsewhere: boolean, paused: boolean): string {
  if (!ready) return "Set up Claude Code or Codex in Settings first.";
  if (busyElsewhere) return "The agent is busy with another run.";
  if (paused) return "Resume the campaign first.";
  return "";
}

function emptyTitle(filter: FilterKey, total: number): string {
  if (total === 0) return "No jobs yet";
  switch (filter) {
    case "waiting":
      return "Nothing is waiting for you";
    case "approved":
      return "No approved jobs";
    case "applied":
      return "Nothing sent yet";
    case "failed":
      return "Nothing failed";
    case "skipped":
      return "Nothing skipped";
    default:
      return "No jobs here";
  }
}

function emptyBody(filter: FilterKey, campaign: Campaign): string {
  if (campaign.summary.totalFound === 0) {
    return campaign.source === "apply"
      ? "Press “Score the links” and the agent opens each one, reads it and scores it against your CV."
      : "Start the agent and it searches the board, then lists every match here with its score and the reason for it.";
  }
  if (filter === "waiting") return "Every job found so far has a decision. Search for more, or see them all.";
  if (filter === "approved") return "Approve jobs from “Waiting for you” and they'll queue here until the agent applies.";
  return "Pick another view above to see the rest.";
}

interface Brief {
  skills?: string[];
  requirements?: string[];
  responsibilities?: string[];
  yearsExperience?: number;
  remote?: boolean;
  employmentType?: string;
  descriptionExcerpt?: string;
}

function parseBrief(raw: string | null): Brief | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Brief) : null;
  } catch {
    return null;
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function JobDetail({ job, bar }: { job: CampaignJob; bar: number }) {
  const brief = parseBrief(job.brief);
  const { run } = useAction();
  const skills = strings(brief?.skills);
  const requirements = strings(brief?.requirements);
  const description = job.description ?? (typeof brief?.descriptionExcerpt === "string" ? brief.descriptionExcerpt : null);
  return (
    <div className="job-detail">
      <div>
        <div className="block row" style={{ alignItems: "flex-end", gap: 16 }}>
          <Score value={job.matchScore} bar={bar} size="lg" />
          <p className="muted" style={{ margin: 0 }}>
            {job.matchScore === null ? "Not scored yet." : job.matchScore >= bar ? `At or above your bar of ${bar}.` : `Below your bar of ${bar}.`}
          </p>
        </div>
        {job.matchReason ? (
          <div className="block">
            <h3>Why this score</h3>
            <p style={{ margin: 0 }}>{job.matchReason}</p>
          </div>
        ) : null}
        {job.failReason || job.skipReason ? (
          <div className="block">
            <h3>{job.failReason ? "Why it didn't go through" : "Why it was skipped"}</h3>
            <p style={{ margin: 0 }}>{job.failReason ?? job.skipReason}</p>
          </div>
        ) : null}
        {job.retryNotes ? (
          <div className="block">
            <h3>Notes for the next try</h3>
            <p style={{ margin: 0 }}>{job.retryNotes}</p>
          </div>
        ) : null}
        {skills.length ? (
          <div className="block">
            <h3>Skills the posting asks for</h3>
            <ul className="chips">
              {skills.slice(0, 30).map((skill) => (
                <li key={skill}>
                  <Tag tone="neutral">{skill}</Tag>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {requirements.length ? (
          <div className="block">
            <h3>Requirements</h3>
            <ul>
              {requirements.slice(0, 12).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {description ? (
          <div className="block">
            <h3>From the posting</h3>
            <p className="description">{description}</p>
          </div>
        ) : null}
      </div>
      <div>
        <dl className="job-facts">
          <dt>Company</dt>
          <dd>{job.company}</dd>
          {job.location ? (
            <>
              <dt>Location</dt>
              <dd>{job.location}</dd>
            </>
          ) : null}
          {job.salary ? (
            <>
              <dt>Salary</dt>
              <dd>{job.salary}</dd>
            </>
          ) : null}
          {job.type || brief?.employmentType ? (
            <>
              <dt>Type</dt>
              <dd>{job.type ?? brief?.employmentType}</dd>
            </>
          ) : null}
          {typeof brief?.remote === "boolean" ? (
            <>
              <dt>Remote</dt>
              <dd>{brief.remote ? "Yes" : "No"}</dd>
            </>
          ) : null}
          {typeof brief?.yearsExperience === "number" ? (
            <>
              <dt>Experience</dt>
              <dd>{plural(brief.yearsExperience, "year")}</dd>
            </>
          ) : null}
          {job.board ? (
            <>
              <dt>Board</dt>
              <dd>{job.board}</dd>
            </>
          ) : null}
          <dt>Found</dt>
          <dd>{formatDateTime(job.createdAt)}</dd>
          {job.appliedAt ? (
            <>
              <dt>Applied</dt>
              <dd>{formatDateTime(job.appliedAt)}</dd>
            </>
          ) : null}
        </dl>
        <div className="row" style={{ marginTop: 16 }}>
          <Button small onClick={() => run("open", () => call("shell.openExternal", job.url))}>
            Open the posting
          </Button>
        </div>
      </div>
    </div>
  );
}
