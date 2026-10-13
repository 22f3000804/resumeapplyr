import { useAgent } from "../agent";
import { call, useRpc } from "../api";
import { duration } from "../format";
import { href } from "../router";
import { Button, useAction, useTick } from "./ui";

const NAV = [
  { section: "home", label: "Home" },
  { section: "campaigns", label: "Campaigns" },
  { section: "applications", label: "Applications" },
  { section: "cvs", label: "CVs" },
  { section: "profile", label: "Profile" },
  { section: "agent", label: "Agent" },
  { section: "settings", label: "Settings" },
] as const;

export function Rail({ section }: { section: string }) {
  const { current } = useAgent();
  const campaigns = useRpc("campaigns.list", [], ["campaigns"]);
  const waiting = (campaigns.data?.items ?? []).reduce((sum, c) => sum + c.summary.awaitingApproval, 0);
  const { busy, run } = useAction();
  useTick(30_000);

  return (
    <nav className="rail" aria-label="Main">
      <p className="rail-brand">resumeapplyr</p>
      <div className="rail-nav">
        {NAV.map((item) => (
          <a key={item.section} href={href(item.section)} aria-current={section === item.section ? "page" : undefined}>
            <span>{item.label}</span>
            {item.section === "campaigns" && waiting > 0 ? (
              <span className="rail-count tnum" title={`${waiting} jobs waiting for your decision`}>
                {waiting}
                <span className="sr-only"> waiting for you</span>
              </span>
            ) : null}
            {item.section === "agent" && current ? (
              <span className="rail-dot" title="The agent is working">
                <span className="sr-only">working</span>
              </span>
            ) : null}
          </a>
        ))}
      </div>
      <div className="rail-agent" aria-live="polite">
        {current ? (
          <>
            <p className="rail-agent-state">
              <span className="pulse" aria-hidden="true" />
              Working, {duration(current.startedAt)}
            </p>
            <p className="rail-agent-title">{current.title}</p>
            <div className="rail-agent-actions">
              <a className="btn btn-secondary btn-small" href={href("agent", current.runId)}>
                Watch
              </a>
              <Button small busy={busy === "stop"} onClick={() => run("stop", () => call("agent.stop"), "Stopping the agent")}>
                Stop
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="rail-agent-state">The agent is idle</p>
            <p className="rail-agent-title">It works only when you start a campaign or ask it for something.</p>
          </>
        )}
      </div>
    </nav>
  );
}
