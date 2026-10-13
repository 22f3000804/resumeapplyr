import { useEffect, useState } from "react";
import type { ResumeDetail, ResumeSummary, VariantSummary } from "../../../shared/types";
import { useAgent, useProvider } from "../agent";
import { call, useRpc } from "../api";
import { ResumeEditor } from "../components/ResumeEditor";
import { ResumePreview } from "../components/ResumePreview";
import { Button, Dialog, Empty, ErrorNote, Loading, PageHeader, Segmented, Tag, useAction, useConfirm } from "../components/ui";
import { formatDate, hostOf, plural } from "../format";
import { href, navigate } from "../router";

type Tab = "preview" | "edit" | "versions";

const MISMATCH_LABEL: Record<string, string> = {
  location: "Location",
  email: "Email",
  phone: "Phone",
  linkedin: "LinkedIn",
  github: "GitHub",
  website: "Website",
};

export function ResumesPage({ id, tab }: { id?: string; tab?: string }) {
  const list = useRpc("resumes.list", [], ["resumes"]);
  const { busy, run } = useAction();
  const items = list.data ?? [];

  // With no CV picked, open the main one.
  useEffect(() => {
    if (!id && items.length) {
      const first = items.find((r) => r.isPrimary) ?? items[0]!;
      window.location.replace(href("cvs", first.id));
    }
  }, [id, items]);

  const importPdf = async () => {
    const created = await run("import", () => call("resumes.import"), (r) => (r ? "PDF added." : null));
    if (created) navigate("cvs", created.id);
  };
  const createBlank = async () => {
    const created = await run("blank", () => call("resumes.createBlank"), "New CV started. Fill it in below.");
    if (created) navigate("cvs", created.id, "edit");
  };

  const actions = (
    <>
      <Button busy={busy === "blank"} onClick={createBlank}>
        Start from scratch
      </Button>
      <Button variant="primary" busy={busy === "import"} onClick={importPdf}>
        Upload a PDF
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title="CVs"
        lead="The agent tailors a copy of your CV for each job. It can reword and reorder what's here, but it never adds a fact that isn't."
        actions={actions}
      />
      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title="No CV yet" action={actions}>
          <p>Upload the PDF you use today and the agent reads it into sections you can edit. Or write one here from scratch.</p>
        </Empty>
      ) : (
        <>
          <nav aria-label="Your CVs">
            <ul className="cv-strip">
              {items.map((r) => (
                <li key={r.id}>
                  <a href={href("cvs", r.id)} aria-current={r.id === id ? "page" : undefined}>
                    <span className="name">{r.label}</span>
                    <span className="meta">{cvMeta(r)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {id ? <ResumeDetailView key={id} id={id} tab={tab as Tab | undefined} /> : <Loading />}
        </>
      )}
    </>
  );
}

function cvMeta(r: ResumeSummary): string {
  const text = [
    r.isPrimary ? "main CV" : null,
    r.hasData ? `edited ${formatDate(r.updatedAt)}` : "not read yet",
    r.variantCount ? plural(r.variantCount, "tailored version") : null,
  ]
    .filter(Boolean)
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ResumeDetailView({ id, tab }: { id: string; tab?: Tab }) {
  const detail = useRpc("resumes.get", [id], ["resumes"]);
  if (detail.error) return <ErrorNote error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;
  return <ResumeView resume={detail.data} tab={tab} />;
}

function ResumeView({ resume, tab }: { resume: ResumeDetail; tab?: Tab }) {
  const provider = useProvider();
  const { current } = useAgent();
  const confirm = useConfirm();
  const { busy, run } = useAction();
  const active: Tab = tab ?? (resume.hasData ? "preview" : resume.sourceFilename ? "preview" : "edit");
  const agentBlocked = !provider.ready ? `Set up ${provider.name} in Settings first.` : current ? `The agent is busy with “${current.title}”.` : null;

  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${resume.label}”?`,
      body: `Its ${plural(resume.variantCount, "tailored version")} go too. Applications already sent keep their record.`,
      confirmLabel: "Delete CV",
      danger: true,
    });
    if (!ok) return;
    const done = await run("delete", () => call("resumes.remove", resume.id).then(() => true), "CV deleted.");
    if (done) navigate("cvs");
  };

  const read = (force: boolean) =>
    run("read", () => call("agent.extractResume", resume.id, force), "The agent is reading your PDF. This takes a minute or two.");

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, alignItems: "flex-start" }}>
        <div>
          <h2 className="section-title" style={{ fontSize: 24 }}>
            {resume.label}
          </h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
            {resume.isPrimary ? "Your main CV: new campaigns start from it. " : ""}
            {resume.sourceFilename ? `Uploaded from ${resume.sourceFilename}.` : "Written in the app."}
          </p>
        </div>
        <div className="row">
          {!resume.isPrimary ? (
            <Button small busy={busy === "primary"} onClick={() => run("primary", () => call("resumes.setPrimary", resume.id), "This is now your main CV.")}>
              Make main CV
            </Button>
          ) : null}
          <Button
            small
            busy={busy === "pdf"}
            disabled={!resume.hasData && !resume.sourceFilename}
            onClick={() => run("pdf", () => call("resumes.exportPdf", { resumeId: resume.id }), (path) => (path ? "PDF saved." : null))}
          >
            Save as PDF
          </Button>
          {resume.sourceFilename ? (
            <Button small busy={busy === "source"} onClick={() => run("source", () => call("resumes.openSource", resume.id))}>
              Open the original
            </Button>
          ) : null}
          <Button small variant="danger" busy={busy === "delete"} onClick={remove}>
            Delete
          </Button>
        </div>
      </div>

      {!resume.hasData && resume.sourceFilename ? (
        <div className="notice notice-accent">
          <p>
            <span className="notice-title">The agent hasn't read this PDF yet.</span> Reading turns it into sections you can edit, and
            that the agent can score against jobs and tailor. Nothing is added or rewritten.
          </p>
          <div className="row">
            <Button variant="primary" small busy={busy === "read"} disabled={!!agentBlocked} onClick={() => read(false)}>
              Read my CV
            </Button>
            {agentBlocked ? <span className="muted">{agentBlocked}</span> : null}
          </div>
        </div>
      ) : null}

      {resume.profileMismatches.length > 0 ? (
        <div className="notice">
          <p className="notice-title">Your CV and your profile disagree</p>
          <ul>
            {resume.profileMismatches.map((m) => (
              <li key={m.field}>
                {MISMATCH_LABEL[m.field] ?? m.field}: the CV says “{m.resume}”, your profile says “{m.profile}”.
              </li>
            ))}
          </ul>
          <p>Application forms use your profile. Fix whichever is out of date.</p>
        </div>
      ) : null}

      <nav aria-label="CV views" style={{ marginBottom: 18 }}>
        <Segmented
          label="View"
          hideLabel
          value={active}
          onChange={(next) => navigate("cvs", resume.id, next)}
          options={[
            { value: "preview", label: "Preview" },
            { value: "edit", label: "Edit" },
            { value: "versions", label: `Tailored versions ${resume.variantCount}` },
          ]}
        />
      </nav>

      {active === "edit" ? (
        <ResumeEditor resume={resume} />
      ) : active === "versions" ? (
        <Versions resume={resume} />
      ) : (
        <div className="editor-layout">
          <ResumePreview target={{ resumeId: resume.id }} caption={resume.hasData ? undefined : "Nothing to show until the agent reads the PDF, or you fill it in."} />
          <div className="stack">
            <div>
              <h3 className="section-title" style={{ fontSize: 17 }}>
                Get suggestions
              </h3>
              <p className="muted" style={{ fontSize: 14 }}>
                The agent reads this CV the way a recruiter would and suggests a rewrite: tighter wording, stronger verbs, better order.
                You see it as a version to accept or discard; it never adds anything that isn't already here.
              </p>
              <Button
                busy={busy === "review"}
                disabled={!resume.hasData || !!agentBlocked}
                onClick={() => run("review", () => call("agent.reviewResume", resume.id), "The agent is reviewing your CV.")}
              >
                Suggest improvements
              </Button>
            </div>
            {resume.sourceFilename && resume.hasData ? (
              <div>
                <h3 className="section-title" style={{ fontSize: 17 }}>
                  Read the PDF again
                </h3>
                <p className="muted" style={{ fontSize: 14 }}>
                  Replaces what's here with a fresh reading of {resume.sourceFilename}. Your edits in the app are lost.
                </p>
                <Button
                  busy={busy === "read"}
                  disabled={!!agentBlocked}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Read the PDF again?",
                      body: "Your edits in the app are replaced by a fresh reading of the PDF.",
                      confirmLabel: "Read again",
                    });
                    if (ok) await read(true);
                  }}
                >
                  Read again
                </Button>
              </div>
            ) : null}
            {agentBlocked ? <p className="muted" style={{ fontSize: 13 }}>{agentBlocked}</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Versions({ resume }: { resume: ResumeDetail }) {
  const variants = useRpc("resumes.variants", [resume.id], ["resumes"]);
  const [viewing, setViewing] = useState<VariantSummary | null>(null);
  const { busy, run } = useAction();
  const confirm = useConfirm();

  if (variants.error) return <ErrorNote error={variants.error} onRetry={variants.reload} />;
  if (!variants.data) return <Loading />;
  if (variants.data.length === 0) {
    return (
      <Empty title="No tailored versions yet">
        <p>When the agent applies, it makes a copy of this CV for that job: same facts, reordered and reworded for the posting. Each one is kept here.</p>
      </Empty>
    );
  }

  const accept = async (v: VariantSummary) => {
    const ok = await confirm({
      title: "Use the suggested rewrite?",
      body: "It replaces the current content of this CV. Save the current one as a PDF first if you want to keep it.",
      confirmLabel: "Use it",
    });
    if (ok) await run(v.id, () => call("resumes.acceptVariant", v.id), "Done. Your CV now uses the rewrite.");
  };
  const remove = async (v: VariantSummary) => {
    const ok = await confirm({
      title: v.isSuggestion ? "Discard the suggestion?" : "Delete this version?",
      body: v.isSuggestion ? "Your CV stays as it is." : "Applications already sent with it keep their record.",
      confirmLabel: v.isSuggestion ? "Discard" : "Delete",
      danger: true,
    });
    if (ok) await run(v.id, () => call("resumes.removeVariant", v.id), v.isSuggestion ? "Suggestion discarded." : "Version deleted.");
  };

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">For</th>
              <th scope="col">Made</th>
              <th scope="col" className="actions-cell">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.data.map((v) => (
              <tr key={v.id}>
                <td>
                  <button type="button" className="row-toggle primary-text" onClick={() => setViewing(v)}>
                    {v.label}
                  </button>
                  {v.isSuggestion ? (
                    <span className="secondary-text">
                      <Tag tone="accent">Suggested by the agent</Tag>
                    </span>
                  ) : null}
                  {v.diffNotes ? <span className="secondary-text clamp-2">{v.diffNotes}</span> : null}
                </td>
                <td>{v.jobUrl ? hostOf(v.jobUrl) : <span className="muted">No job</span>}</td>
                <td className="nowrap">{formatDate(v.createdAt)}</td>
                <td className="actions-cell">
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    {v.isSuggestion ? (
                      <Button small variant="primary" busy={busy === v.id} onClick={() => accept(v)}>
                        Use this
                      </Button>
                    ) : null}
                    <Button
                      small
                      busy={busy === `pdf-${v.id}`}
                      onClick={() => run(`pdf-${v.id}`, () => call("resumes.exportPdf", { variantId: v.id }), (path) => (path ? "PDF saved." : null))}
                    >
                      Save as PDF
                    </Button>
                    <Button small variant="ghost" busy={busy === v.id} onClick={() => remove(v)}>
                      {v.isSuggestion ? "Discard" : "Delete"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!viewing} onClose={() => setViewing(null)} wide title={viewing?.label ?? ""} actions={<Button onClick={() => setViewing(null)}>Close</Button>}>
        {viewing ? (
          <div className="cv-dialog-preview">
            {viewing.diffNotes ? <p className="muted">{viewing.diffNotes}</p> : null}
            <ResumePreview target={{ variantId: viewing.id }} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
