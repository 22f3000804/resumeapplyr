import { useEffect, useState } from "react";
import { APPLICATION_STATUSES, type ApplicationStatus } from "../../../core/schemas/application";
import { useAgent, useProvider } from "../agent";
import { call, useRpc } from "../api";
import { ApplicationStatusTag } from "../components/status";
import {
  Button,
  Dialog,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  Score,
  Section,
  SelectField,
  TextAreaField,
  TextField,
  useAction,
  useConfirm,
} from "../components/ui";
import { APPLICATION_STATUS_LABEL, formatDate, formatDateTime, hostOf, plural } from "../format";
import { href } from "../router";

const STATUS_OPTIONS = APPLICATION_STATUSES.map((s) => ({ value: s, label: APPLICATION_STATUS_LABEL[s] }));

export function ApplicationsPage() {
  const [status, setStatus] = useState<ApplicationStatus | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [status, query]);

  const list = useRpc("applications.list", [{ status: status || undefined, search: query || undefined, page }], ["applications", "letters"]);
  const stats = useRpc("applications.stats", [], ["applications", "settings", "campaigns"]);
  const settings = useRpc("settings.get", [], ["settings"]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [writing, setWriting] = useState(false);
  const { busy, run } = useAction();
  const bar = settings.data?.minMatchScore ?? 60;
  const total = stats.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Applications"
        lead="Everything sent, by the agent or by you. The agent checks this list before every application, so it won't apply to the same job twice."
        actions={
          <>
            <Button onClick={() => setWriting(true)}>Write a cover letter</Button>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add one you sent yourself
            </Button>
          </>
        }
      />

      <div className="toolbar">
        <SelectFilter value={status} onChange={setStatus} counts={stats.data?.byStatus ?? {}} total={total} />
        <div className="field" style={{ width: 280 }}>
          <label className="sr-only" htmlFor="application-search">
            Search applications
          </label>
          <input
            id="application-search"
            className="input"
            type="search"
            placeholder="Search by job or company"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        total === 0 ? (
          <Empty title="No applications yet">
            <p>
              They appear here as the agent sends them. If you've applied somewhere yourself, add it, and the agent will skip that job.
            </p>
          </Empty>
        ) : (
          <Empty title="Nothing matches">
            <p>Try another status or a shorter search.</p>
          </Empty>
        )
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Score</th>
                <th scope="col">Job</th>
                <th scope="col">Where</th>
                <th scope="col">Status</th>
                <th scope="col">Sent</th>
                <th scope="col" className="actions-cell">
                  <span className="sr-only">Change status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id}>
                  <td className="score-cell">
                    <Score value={a.matchScore} bar={bar} />
                  </td>
                  <td>
                    <button type="button" className="row-toggle primary-text" onClick={() => setOpenId(a.id)}>
                      {a.title}
                    </button>
                    <span className="secondary-text">{a.company}</span>
                  </td>
                  <td>
                    {a.board ?? hostOf(a.url)}
                    <span className="secondary-text">{a.source === "manual" ? "Sent by you" : "Sent by the agent"}</span>
                  </td>
                  <td>
                    <ApplicationStatusTag status={a.status} />
                    {a.unchecked ? <span className="secondary-text accent-text">Sent without the app's checks</span> : null}
                  </td>
                  <td className="nowrap tnum">{formatDate(a.appliedAt)}</td>
                  <td className="actions-cell">
                    <label className="sr-only" htmlFor={`status-${a.id}`}>
                      Status of {a.title}
                    </label>
                    <select
                      id={`status-${a.id}`}
                      className="input select"
                      style={{ width: 150, minHeight: 32, fontSize: 13 }}
                      value={a.status}
                      disabled={busy === a.id}
                      onChange={(event) =>
                        run(a.id, () => call("applications.update", a.id, { status: event.target.value }), `Marked as ${APPLICATION_STATUS_LABEL[event.target.value as ApplicationStatus].toLowerCase()}.`)
                      }
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.data && list.data.pagination.totalPages > 1 ? (
        <div className="pager">
          <Button small disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="tnum">
            Page {list.data.pagination.page} of {list.data.pagination.totalPages}
          </span>
          <Button small disabled={page >= list.data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}

      <LettersSection onWrite={() => setWriting(true)} />

      <ApplicationDialog id={openId} onClose={() => setOpenId(null)} />
      <AddApplicationDialog open={adding} onClose={() => setAdding(false)} />
      <CoverLetterDialog open={writing} onClose={() => setWriting(false)} />
    </>
  );
}

function SelectFilter({
  value,
  onChange,
  counts,
  total,
}: {
  value: ApplicationStatus | "";
  onChange: (value: ApplicationStatus | "") => void;
  counts: Record<string, number>;
  total: number;
}) {
  return (
    <fieldset className="seg-field">
      <legend className="sr-only">Show</legend>
      <div className="seg">
        {[{ value: "" as const, label: `All ${total}` }, ...STATUS_OPTIONS.map((o) => ({ ...o, label: `${o.label} ${counts[o.value] ?? 0}` }))].map(
          (option) => (
            <label className="seg-opt" key={option.value || "all"}>
              <input type="radio" name="application-status" checked={value === option.value} onChange={() => onChange(option.value)} />
              {option.label}
            </label>
          ),
        )}
      </div>
    </fieldset>
  );
}

function ApplicationDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useRpc("applications.get", [id ?? ""], ["applications", "letters"], { skip: !id });
  const variant = useRpc("resumes.variant", [detail.data?.resumeVariantId ?? ""], ["resumes"], { skip: !detail.data?.resumeVariantId });
  const [notes, setNotes] = useState("");
  const { busy, run } = useAction();
  const confirm = useConfirm();
  useEffect(() => setNotes(detail.data?.notes ?? ""), [detail.data?.id, detail.data?.notes]);
  const a = detail.data;

  const remove = async () => {
    if (!a) return;
    const ok = await confirm({
      title: "Remove this application?",
      body: "It leaves your history, and the agent could apply to this job again. To keep a record of a rejection, change its status instead.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    const done = await run("remove", () => call("applications.remove", a.id).then(() => true), "Application removed.");
    if (done) onClose();
  };

  return (
    <Dialog
      open={!!id}
      onClose={onClose}
      wide
      title={a ? `${a.title}, ${a.company}` : "Application"}
      actions={
        a ? (
          <>
            <Button variant="danger" busy={busy === "remove"} onClick={remove} style={{ marginRight: "auto" }}>
              Remove
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        ) : undefined
      }
    >
      {detail.error ? (
        <ErrorNote error={detail.error} />
      ) : !a ? (
        <Loading />
      ) : (
        <>
          {a.unchecked ? (
            <div className="notice notice-accent">
              <p>
                The agent recorded this without passing the app's approval and limit checks first. If you didn't mean it to go out,
                look at your settings and the agent's activity for that day.
              </p>
            </div>
          ) : null}
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <ApplicationStatusTag status={a.status} />
            </dd>
            <dt>Sent</dt>
            <dd>{formatDateTime(a.appliedAt)}</dd>
            {a.location ? (
              <>
                <dt>Location</dt>
                <dd>{a.location}</dd>
              </>
            ) : null}
            <dt>Posting</dt>
            <dd>
              <button type="button" className="link-button" onClick={() => run("open", () => call("shell.openExternal", a.url))}>
                {hostOf(a.url) || a.url}
              </button>
            </dd>
            {a.matchReason ? (
              <>
                <dt>Why it matched</dt>
                <dd>{a.matchReason}</dd>
              </>
            ) : null}
            {variant.data ? (
              <>
                <dt>CV sent</dt>
                <dd>
                  <a href={href("cvs", variant.data.resumeId, "versions")} onClick={onClose}>
                    {variant.data.label}
                  </a>
                </dd>
              </>
            ) : null}
            {a.coverLetterId ? (
              <>
                <dt>Cover letter</dt>
                <dd>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => run("letter", () => call("letters.exportPdf", a.coverLetterId!), (path) => (path ? "Saved." : null))}
                  >
                    Save as PDF
                  </button>
                </dd>
              </>
            ) : null}
            {a.campaignId ? (
              <>
                <dt>Campaign</dt>
                <dd>
                  <a href={href("campaigns", a.campaignId)} onClick={onClose}>
                    Open the campaign
                  </a>
                </dd>
              </>
            ) : null}
          </dl>

          <SelectField
            label="Change status"
            value={a.status}
            onChange={(value) => run("status", () => call("applications.update", a.id, { status: value }), "Status changed.")}
            options={STATUS_OPTIONS}
          />

          <TextAreaField label="Notes" value={notes} onChange={setNotes} rows={3} placeholder="Recruiter's name, interview dates, anything to remember." />
          <div className="row">
            <Button
              disabled={notes === (a.notes ?? "")}
              busy={busy === "notes"}
              onClick={() => run("notes", () => call("applications.update", a.id, { notes }), "Notes saved.")}
            >
              Save notes
            </Button>
          </div>

          {a.events.length > 0 ? (
            <div>
              <p className="field-label">History</p>
              <ul className="list-plain list-rows">
                {a.events.map((event) => (
                  <li key={event.id} className="row-between">
                    <span>
                      {event.toStatus ? APPLICATION_STATUS_LABEL[event.toStatus as ApplicationStatus] ?? event.toStatus : "Note"}
                      {event.note ? <span className="muted">: {event.note}</span> : null}
                    </span>
                    <span className="muted nowrap">{formatDateTime(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  );
}

function AddApplicationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!/^https?:\/\/\S+\.\S+/i.test(url.trim())) next.url = "Paste the full link to the posting, starting with https://.";
    if (!title.trim()) next.title = "Add the job title.";
    if (!company.trim()) next.company = "Add the company.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const created = await run(
      "add",
      () =>
        call("applications.create", {
          url: url.trim(),
          title: title.trim(),
          company: company.trim(),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      "Added. The agent will skip this job.",
    );
    if (created) {
      setUrl("");
      setTitle("");
      setCompany("");
      setLocation("");
      setNotes("");
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an application you sent yourself"
      onSubmit={() => void submit()}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy === "add"}>
            Add application
          </Button>
        </>
      }
    >
      <p className="dialog-body" style={{ margin: 0 }}>
        So the agent knows not to apply to it again.
      </p>
      <TextField label="Link to the posting" type="url" value={url} onChange={setUrl} error={errors.url} />
      <div className="grid-2">
        <TextField label="Job title" value={title} onChange={setTitle} error={errors.title} />
        <TextField label="Company" value={company} onChange={setCompany} error={errors.company} />
      </div>
      <TextField label="Location (optional)" value={location} onChange={setLocation} />
      <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} rows={3} />
    </Dialog>
  );
}

function CoverLetterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const provider = useProvider();
  const { current } = useAgent();

  const submit = async () => {
    const url = jobUrl.trim();
    if (!url && !jobText.trim()) {
      setError("Paste a link to the posting, or its text.");
      return;
    }
    if (url && !/^https?:\/\/\S+\.\S+/i.test(url)) {
      setError("The link should start with https://.");
      return;
    }
    setError(null);
    const started = await run(
      "write",
      () =>
        call("agent.coverLetter", {
          ...(url ? { jobUrl: url } : {}),
          ...(jobText.trim() ? { jobText: jobText.trim() } : {}),
          ...(company.trim() ? { company: company.trim() } : {}),
        }),
      "The agent is writing it. It appears under Cover letters when it's done.",
    );
    if (started) {
      setJobUrl("");
      setJobText("");
      setCompany("");
      onClose();
    }
  };

  const blocked = !provider.ready ? `${provider.name} isn't set up yet. Set it up in Settings first.` : current ? `The agent is busy with “${current.title}”.` : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Write a cover letter"
      onSubmit={() => void submit()}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy === "write"} disabled={!!blocked}>
            Write it
          </Button>
        </>
      }
    >
      <p className="dialog-body" style={{ margin: 0 }}>
        Written from your CV and the posting, in plain language, with nothing added that isn't in your history.
      </p>
      <TextField label="Link to the posting" type="url" value={jobUrl} onChange={setJobUrl} error={error} />
      <TextAreaField label="Or paste the posting" value={jobText} onChange={setJobText} rows={6} />
      <TextField label="Company (optional)" value={company} onChange={setCompany} />
      {blocked ? <p className="notice">{blocked}</p> : null}
    </Dialog>
  );
}

function LettersSection({ onWrite }: { onWrite: () => void }) {
  const letters = useRpc("letters.list", [], ["letters"]);
  const [viewing, setViewing] = useState<string | null>(null);
  const letter = useRpc("letters.get", [viewing ?? ""], ["letters"], { skip: !viewing });
  const { busy, run } = useAction();
  const items = letters.data?.items ?? [];
  return (
    <Section
      title="Cover letters"
      description="Letters the agent wrote, for applications or on request."
      actions={
        <Button small onClick={onWrite}>
          Write one
        </Button>
      }
    >
      {!letters.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="muted">None yet. The agent writes one when a form asks for it, or when you ask.</p>
      ) : (
        <ul className="list-plain list-rows">
          {items.map((l) => (
            <li key={l.id} className="row-between">
              <div>
                <button type="button" className="row-toggle" onClick={() => setViewing(l.id)}>
                  {[l.jobTitle, l.company].filter(Boolean).join(", ") || "Cover letter"}
                </button>
                <span className="muted"> {formatDate(l.createdAt)}</span>
              </div>
              <Button
                small
                busy={busy === l.id}
                onClick={() => run(l.id, () => call("letters.exportPdf", l.id), (path) => (path ? "Saved." : null))}
              >
                Save as PDF
              </Button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 ? <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{plural(items.length, "letter")}.</p> : null}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        wide
        title={letter.data ? [letter.data.jobTitle, letter.data.company].filter(Boolean).join(", ") || "Cover letter" : "Cover letter"}
        actions={<Button onClick={() => setViewing(null)}>Close</Button>}
      >
        {!letter.data ? <Loading /> : <p className="letter-text">{letter.data.content}</p>}
      </Dialog>
    </Section>
  );
}
