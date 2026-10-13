import type { ReactNode } from "react";
import { missingProfileFields } from "../../../core/schemas/profile";
import { useAgent, useProvider } from "../agent";
import { useRpc } from "../api";
import { RunStatusTag } from "../components/status";
import { ErrorNote, Loading, PageHeader, Section, Stat, useTick } from "../components/ui";
import { plural, relative } from "../format";
import { href, Link } from "../router";
import { signedInOnce } from "./Settings";

export function HomePage() {
  const profile = useRpc("profile.get", [], ["profile"]);
  const resumes = useRpc("resumes.list", [], ["resumes"]);
  const campaigns = useRpc("campaigns.list", [], ["campaigns"]);
  const stats = useRpc("applications.stats", [], ["applications", "settings", "campaigns"]);
  const runs = useRpc("agent.runs", [], ["runs"]);
  const provider = useProvider();
  const { current } = useAgent();
  useTick(60_000);

  if (profile.error) return <ErrorNote error={profile.error} onRetry={profile.reload} />;
  if (!profile.data || !resumes.data || !campaigns.data || !stats.data) return <Loading />;

  const missing = missingProfileFields(profile.data);
  const hasCv = resumes.data.some((r) => r.hasData);
  const hasPdfOnly = !hasCv && resumes.data.length > 0;
  const campaignList = campaigns.data.items;
  const waiting = campaignList.filter((c) => c.summary.awaitingApproval > 0);
  const waitingTotal = waiting.reduce((sum, c) => sum + c.summary.awaitingApproval, 0);
  const s = stats.data;

  const steps: { done: boolean; title: string; body: ReactNode; action: ReactNode }[] = [
    {
      done: provider.ready,
      title: provider.ready ? `${provider.name} is ready` : "Connect an AI tool",
      body: provider.ready
        ? `The agent runs on your own ${provider.name} subscription. Nothing goes through resumeapplyr's servers.`
        : provider.known
          ? `resumeapplyr runs the agent through Claude Code or Codex on this computer, with your own subscription. ${provider.name} wasn't found.`
          : "Checking which AI tools this computer has.",
      action: provider.ready ? null : (
        <a className="btn btn-secondary btn-small" href={href("settings")}>
          Set up
        </a>
      ),
    },
    {
      done: hasCv,
      title: "Add your CV",
      body: hasCv
        ? "Every application starts from it. The agent tailors a copy to each job and never adds facts that aren't in it."
        : hasPdfOnly
          ? "Your PDF is in. Let the agent read it so its contents can be scored against jobs."
          : "Upload the PDF you use today, or write one here from scratch.",
      action: hasCv ? null : (
        <a className="btn btn-secondary btn-small" href={href("cvs")}>
          {hasPdfOnly ? "Read it" : "Add CV"}
        </a>
      ),
    },
    {
      done: missing.length === 0,
      title: "Fill in your profile",
      body:
        missing.length === 0
          ? "Forms get your contact details, where you can work and your salary range from here."
          : `Application forms can't go out without your ${missing.join(", ")}.`,
      action:
        missing.length === 0 ? null : (
          <a className="btn btn-secondary btn-small" href={href("profile")}>
            Open profile
          </a>
        ),
    },
    {
      done: signedInOnce(),
      title: "Sign in to your job boards",
      body: "The agent uses its own browser window. Sign in there once and it stays signed in. The app never sees your passwords.",
      action: (
        <a className="btn btn-secondary btn-small" href={href("settings")}>
          {signedInOnce() ? "Sign in to another" : "Open browser"}
        </a>
      ),
    },
    {
      done: campaignList.length > 0,
      title: "Start a campaign",
      body: "Pick a role and a job board. The agent finds postings and scores each one against your CV.",
      action:
        campaignList.length > 0 ? null : (
          <a className="btn btn-primary btn-small" href={href("campaigns", "new")}>
            New campaign
          </a>
        ),
    },
  ];
  const setupDone = steps.filter((step) => step.done).length;
  // Signing in can't be checked from here, so it never holds the list open on its own.
  const SIGN_IN = 3;
  const showSetup = steps.some((step, index) => !step.done && index !== SIGN_IN);
  const started = campaignList.length > 0;

  const lead = current
    ? `The agent is working: ${current.title}.`
    : s.remainingToday === 0
      ? `You've reached today's limit of ${s.dailyLimit} applications. More can go tomorrow.`
      : `${plural(s.remainingToday, "more application")} can go out today, within your daily limit of ${s.dailyLimit}.`;

  return (
    <>
      <PageHeader title="Today" lead={lead} />

      {campaignList.length > 0 || s.total > 0 ? (
        <div className="stats" role="group" aria-label="Your numbers">
          <Stat value={s.today} label={`Sent today, of ${s.dailyLimit}`} />
          <Stat value={s.thisWeek} label="Sent in the last 7 days" />
          <Stat value={waitingTotal} label="Jobs waiting for your decision" accent={waitingTotal > 0} />
          <Stat value={(s.byStatus.interviewing ?? 0) + (s.byStatus.offer ?? 0)} label="Interviews and offers" />
        </div>
      ) : null}

      {showSetup ? (
        <Section
          title={started ? "Finish setting up" : "Before the first campaign"}
          description={`${setupDone} of ${steps.length} done. Do these in order; each takes a minute or two.`}
        >
          <ol className="checklist">
            {steps.map((step, index) => (
              <li key={step.title} className={step.done ? "is-done" : undefined}>
                <span className="check-mark" aria-hidden="true">
                  {step.done ? "✓" : index + 1}
                </span>
                <div>
                  <p className="checklist-title">
                    {step.title}
                    {step.done ? <span className="sr-only"> (done)</span> : null}
                  </p>
                  <p className="checklist-body">{step.body}</p>
                </div>
                <div>{step.action}</div>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section
        title="Waiting for your decision"
        description="Jobs the agent found and scored. Nothing is sent until you approve it, unless you've set a score to auto-send."
      >
        {waiting.length === 0 ? (
          <p className="muted">Nothing is waiting. New matches show up here as campaigns run.</p>
        ) : (
          <ul className="list-plain list-rows">
            {waiting.map((campaign) => (
              <li key={campaign.id} className="row-between">
                <div>
                  <Link to={["campaigns", campaign.id]} className="primary-text">
                    {campaign.query}
                  </Link>
                  <span className="muted"> on {campaign.config.board ?? "pasted links"}</span>
                </div>
                <Link to={["campaigns", campaign.id]} className="btn btn-secondary btn-small">
                  Review {plural(campaign.summary.awaitingApproval, "job")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Recent agent runs"
        actions={
          <a className="btn btn-ghost btn-small" href={href("agent")}>
            All runs
          </a>
        }
      >
        {!runs.data ? (
          <Loading />
        ) : runs.data.length === 0 ? (
          <p className="muted">The agent hasn't run yet.</p>
        ) : (
          <ul className="list-plain list-rows">
            {runs.data.slice(0, 5).map((run) => (
              <li key={run.id} className="row-between">
                <div>
                  <Link to={["agent", run.id]} className="primary-text">
                    {run.title}
                  </Link>
                  <span className="muted"> {relative(run.startedAt)}</span>
                </div>
                <RunStatusTag status={run.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
