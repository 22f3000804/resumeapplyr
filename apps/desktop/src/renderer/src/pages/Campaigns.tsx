import { useState } from "react";
import { type CampaignSource, MAX_APPLY_URLS } from "../../../core/schemas/campaign";
import { useAgent, useProvider } from "../agent";
import { call, useRpc } from "../api";
import { CampaignStatusTag } from "../components/status";
import {
  Button,
  Dialog,
  Empty,
  ErrorNote,
  Loading,
  NumberField,
  PageHeader,
  Segmented,
  SelectField,
  TextAreaField,
  TextField,
  useAction,
  useTick,
} from "../components/ui";
import { relative, SOURCE_LABEL } from "../format";
import { href, Link, navigate } from "../router";

export function CampaignsPage({ creating }: { creating: boolean }) {
  const campaigns = useRpc("campaigns.list", [], ["campaigns"]);
  useTick(60_000);
  const close = () => navigate("campaigns");

  const newButton = (
    <a className="btn btn-primary" href={href("campaigns", "new")}>
      New campaign
    </a>
  );

  return (
    <>
      <PageHeader
        title="Campaigns"
        lead="A campaign is one search on one job board, or a list of links you paste. The agent finds postings, scores each against your CV, and applies where you allow."
        actions={newButton}
      />
      {campaigns.error ? (
        <ErrorNote error={campaigns.error} onRetry={campaigns.reload} />
      ) : !campaigns.data ? (
        <Loading />
      ) : campaigns.data.items.length === 0 ? (
        <Empty title="No campaigns yet" action={newButton}>
          <p>Start with a role and a place, like “product designer, Berlin”, and a board you use. You'll see every match and its score before anything is sent.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Search</th>
                <th scope="col">Board</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Found
                </th>
                <th scope="col" className="num">
                  Waiting for you
                </th>
                <th scope="col" className="num">
                  Applied
                </th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={["campaigns", c.id]} className="primary-text">
                      {c.query}
                    </Link>
                    <span className="secondary-text">{SOURCE_LABEL[c.source]}</span>
                  </td>
                  <td>{c.config.board ?? <span className="muted">Pasted links</span>}</td>
                  <td>
                    <CampaignStatusTag status={c.status} />
                  </td>
                  <td className="num tnum">{c.summary.totalFound}</td>
                  <td className="num tnum">
                    {c.summary.awaitingApproval > 0 ? <strong className="accent-text">{c.summary.awaitingApproval}</strong> : 0}
                  </td>
                  <td className="num tnum">{c.summary.applied}</td>
                  <td className="nowrap muted">{relative(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewCampaignDialog open={creating} onClose={close} />
    </>
  );
}

function NewCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const boards = useRpc("boards.list", [], ["boards"], { skip: !open });
  const resumes = useRpc("resumes.list", [], ["resumes"], { skip: !open });
  const settings = useRpc("settings.get", [], ["settings"], { skip: !open });
  const provider = useProvider();
  const { current } = useAgent();
  const { busy, run } = useAction();

  const [source, setSource] = useState<CampaignSource>("search");
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [minScore, setMinScore] = useState<number | null>(null);
  const [maxApplications, setMaxApplications] = useState<number | null>(null);
  const [maxJobs, setMaxJobs] = useState<number | null>(50);
  const [links, setLinks] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const boardValue = board || boards.data?.[0]?.domain || "";
  const usable = (resumes.data ?? []).filter((r) => r.hasData);
  const primary = usable.find((r) => r.isPrimary) ?? usable[0];
  const resumeValue = resumeId || primary?.id || "";
  const s = settings.data;
  const urls = links
    .split(/\s+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const explain = () => {
    if (!s) return "";
    const auto = s.approvalMode === "auto";
    if (source === "search") return "The agent finds postings and scores each one. Nothing is sent; you approve the ones to apply to.";
    if (source === "auto_apply") {
      return auto
        ? `The agent finds postings and applies on its own to those scoring ${s.autoApplyThreshold} or more. The rest wait for you.`
        : "The agent finds and scores postings, then applies to the ones you approve.";
    }
    return auto
      ? `The agent opens each link and scores it, then applies on its own to those scoring ${s.autoApplyThreshold} or more.`
      : "The agent opens each link and scores it. You approve which ones to send.";
  };

  const submit = async (start: boolean) => {
    const next: Record<string, string> = {};
    if (!query.trim()) next.query = source === "apply" ? "Give this list a name." : "Say what to search for.";
    if (source !== "apply" && !boardValue) next.board = "Pick a board.";
    if (source === "apply") {
      if (urls.length === 0) next.links = "Paste at least one link.";
      else if (urls.length > MAX_APPLY_URLS) next.links = `Up to ${MAX_APPLY_URLS} links per campaign.`;
      else if (urls.some((u) => !/^https?:\/\/\S+\.\S+/i.test(u))) next.links = "Each line should be a full link starting with https://.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const campaign = await run(
      start ? "start" : "save",
      () =>
        call(
          "campaigns.create",
          {
            query: query.trim(),
            source,
            config: {
              ...(source !== "apply" ? { board: boardValue } : {}),
              ...(resumeValue ? { resumeId: resumeValue } : {}),
              ...(minScore !== null ? { minScore } : {}),
              ...(maxApplications !== null ? { maxApplications } : {}),
              ...(source === "search" && maxJobs !== null ? { maxJobs } : {}),
            },
            ...(source === "apply" ? { urls } : {}),
          },
          start,
        ),
      start ? "Campaign created. The agent is starting." : "Campaign created.",
    );
    if (campaign) {
      setQuery("");
      setLinks("");
      navigate("campaigns", campaign.id);
    }
  };

  const canStart = provider.ready && !current;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New campaign"
      wide
      onSubmit={() => void submit(canStart)}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button busy={busy === "save"} onClick={() => void submit(false)} variant={canStart ? "secondary" : "primary"}>
            Create without starting
          </Button>
          {canStart ? (
            <Button type="submit" variant="primary" busy={busy === "start"}>
              Create and start
            </Button>
          ) : null}
        </>
      }
    >
      <Segmented
        label="What should the agent do?"
        value={source}
        onChange={setSource}
        options={[
          { value: "search", label: SOURCE_LABEL.search },
          { value: "auto_apply", label: SOURCE_LABEL.auto_apply },
          { value: "apply", label: SOURCE_LABEL.apply },
        ]}
        hint={explain()}
      />

      <TextField
        label={source === "apply" ? "Name" : "Search for"}
        value={query}
        onChange={setQuery}
        error={errors.query}
        placeholder={source === "apply" ? "Links from friends, March" : "Product designer, Berlin"}
        hint={source === "apply" ? undefined : "A role and a place work best. Add “remote” if that's what you want."}
        maxLength={300}
      />

      {source === "apply" ? (
        <TextAreaField
          label="Job links"
          value={links}
          onChange={setLinks}
          error={errors.links}
          rows={6}
          placeholder={"https://boards.greenhouse.io/…\nhttps://jobs.lever.co/…"}
          hint={`One per line, up to ${MAX_APPLY_URLS}. ${urls.length ? `${urls.length} so far.` : ""}`}
        />
      ) : (
        <SelectField
          label="Job board"
          value={boardValue}
          onChange={setBoard}
          error={errors.board}
          options={(boards.data ?? []).map((b) => ({ value: b.domain, label: `${b.name} (${b.domain})` }))}
          hint={
            <>
              Sign in to it first in the agent's browser (<a href={href("settings")}>Settings</a>) if it needs an account.
            </>
          }
        />
      )}

      <div className="grid-3">
        {usable.length > 0 ? (
          <SelectField
            label="CV to start from"
            value={resumeValue}
            onChange={setResumeId}
            options={usable.map((r) => ({ value: r.id, label: r.isPrimary ? `${r.label} (main)` : r.label }))}
          />
        ) : (
          <div className="field">
            <p className="field-label">CV to start from</p>
            <p className="field-hint">
              No CV yet. <a href={href("cvs")}>Add one</a> first, or applications will stop and ask.
            </p>
          </div>
        )}
        <NumberField
          label="Lowest score to keep"
          value={minScore}
          onChange={setMinScore}
          min={0}
          max={100}
          placeholder={String(s?.minMatchScore ?? 60)}
          hint="Jobs below this are skipped."
        />
        {source !== "search" ? (
          <NumberField
            label="Most applications"
            value={maxApplications}
            onChange={setMaxApplications}
            min={1}
            max={500}
            placeholder={s?.maxApplicationsPerCampaign ? String(s.maxApplicationsPerCampaign) : "No limit"}
            hint={`Your daily limit of ${s?.dailyApplicationLimit ?? 25} still applies.`}
          />
        ) : (
          <NumberField
            label="Most jobs to look at"
            value={maxJobs}
            onChange={setMaxJobs}
            min={1}
            max={1000}
            placeholder="No limit"
          />
        )}
      </div>

      {!provider.ready && provider.known ? (
        <p className="notice">
          {provider.name} isn't set up on this computer yet, so the campaign can't start now. You can create it and start it
          later. <a href={href("settings")}>Set up {provider.name}</a>
        </p>
      ) : current ? (
        <p className="notice">The agent is busy with “{current.title}”. Create this now and start it when that finishes.</p>
      ) : null}
    </Dialog>
  );
}
