import { useEffect, useRef, useState } from "react";
import type { Settings } from "../../../core/schemas/settings";
import type { ProviderStatus } from "../../../shared/types";
import { useAgent } from "../agent";
import { call, useRpc } from "../api";
import {
  Button,
  ErrorNote,
  Loading,
  NumberField,
  PageHeader,
  Section,
  Segmented,
  SelectField,
  TextField,
  useAction,
  useConfirm,
} from "../components/ui";
import { formatDate } from "../format";

const SIGNED_IN_KEY = "resumeapplyr.signedInOnce";

/** Whether the user has opened the agent's browser to sign in at least once (on this computer). */
export function signedInOnce(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberSignedIn(): void {
  try {
    window.localStorage.setItem(SIGNED_IN_KEY, "1");
  } catch {
    // Only drives a checklist tick on Home.
  }
}

export function SettingsPage() {
  const settings = useRpc("settings.get", [], ["settings"]);
  if (settings.error) return <ErrorNote error={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <Loading />;
  return <SettingsView settings={settings.data} />;
}

function SettingsView({ settings }: { settings: Settings }) {
  const { busy, run } = useAction();
  const save = (patch: Partial<Settings>, message = "Saved.") => run("settings", () => call("settings.update", patch), message);

  return (
    <>
      <PageHeader title="Settings" lead="Everything here is stored on this computer." />
      <AiToolSection settings={settings} save={save} />
      <BrowserSection settings={settings} save={save} />
      <RulesSection settings={settings} />
      <BoardsSection />
      <AnswersSection />
      <Section title="Documents" description="Paper size for the CVs and cover letters the app makes.">
        <Segmented
          label="Paper size"
          value={settings.paperSize}
          onChange={(paperSize) => save({ paperSize }, `PDFs will be ${paperSize === "A4" ? "A4" : "US Letter"}.`)}
          options={[
            { value: "A4", label: "A4" },
            { value: "Letter", label: "US Letter" },
          ]}
        />
      </Section>
      <DataSection busy={busy} />
    </>
  );
}

type Save = (patch: Partial<Settings>, message?: string) => Promise<unknown>;

function AiToolSection({ settings, save }: { settings: Settings; save: Save }) {
  const { setup, checking, checkSetup } = useAgent();
  const [model, setModel] = useState(settings.model);
  useEffect(() => setModel(settings.model), [settings.model]);

  return (
    <Section
      title="AI tool"
      description="resumeapplyr runs the agent through Claude Code or Codex on this computer, signed in with your own subscription. Nothing passes through resumeapplyr's servers."
      actions={
        <Button small busy={checking} onClick={() => checkSetup(true)}>
          Check again
        </Button>
      }
    >
      <div className="stack">
        <Segmented
          label="Use"
          value={settings.provider}
          onChange={(provider) => save({ provider }, `The agent will use ${provider === "codex" ? "Codex" : "Claude Code"}.`)}
          options={[
            { value: "claude", label: "Claude Code" },
            { value: "codex", label: "Codex" },
          ]}
        />
        {!setup ? (
          <Loading label="Looking for Claude Code and Codex" />
        ) : (
          <div className="provider-list">
            {setup.providers.map((p) => (
              <ProviderCard key={p.id} status={p} selected={p.id === settings.provider} />
            ))}
          </div>
        )}
        {setup && !setup.node.installed ? (
          <div className="notice notice-accent">
            <p>
              <span className="notice-title">Node.js isn't installed.</span> The agent drives its browser with a small Node.js tool.
              Install the LTS version from nodejs.org, then press Check again.
            </p>
          </div>
        ) : setup ? (
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            Node.js {setup.node.version} found, for the browser tool. Last checked {formatDate(setup.checkedAt)}.
          </p>
        ) : null}
        <div className="grid-2">
          <TextField
            label="Model"
            value={model}
            onChange={setModel}
            placeholder={settings.provider === "codex" ? "Codex's default" : "Sonnet (the default)"}
            hint="Leave empty for the default. Any model name your subscription offers works, like opus."
          />
          <div style={{ paddingTop: 22 }}>
            <Button disabled={model.trim() === settings.model} onClick={() => save({ model: model.trim() }, "Model saved.")}>
              Save model
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

function ProviderCard({ status, selected }: { status: ProviderStatus; selected: boolean }) {
  const login = status.id === "codex" ? "codex login" : "claude";
  const install =
    status.id === "codex" ? "Install it with npm install -g @openai/codex" : "Install it from claude.com/code, or with npm install -g @anthropic-ai/claude-code";
  return (
    <div className={`provider${selected ? " is-selected" : ""}`}>
      <h3>
        {status.name}
        {selected ? <span className="sr-only"> (selected)</span> : null}
      </h3>
      {status.installed ? (
        <>
          <p>Found{status.version ? `: ${status.version}` : ""}.</p>
          {status.path ? <p className="muted">{status.path}</p> : null}
          {status.missingFlags.length ? (
            <p className="accent-text">This version is too old for the app (it lacks {status.missingFlags.join(", ")}). Update it, then check again.</p>
          ) : (
            <p>
              If runs fail with a sign-in error, open a terminal and run <code>{login}</code> once.
            </p>
          )}
        </>
      ) : (
        <>
          <p>Not found on this computer.</p>
          <p>{install}, sign in once in a terminal, then press Check again.</p>
        </>
      )}
    </div>
  );
}

function BrowserSection({ settings, save }: { settings: Settings; save: Save }) {
  const boards = useRpc("boards.list", [], ["boards"]);
  const status = useRpc("browser.status", [], []);
  const [target, setTarget] = useState("");
  const { busy, run } = useAction();
  const confirm = useConfirm();
  const { current } = useAgent();
  const list = boards.data ?? [];
  const chosen = target || list[0]?.domain || "";
  const board = list.find((b) => b.domain === chosen);
  const url = board ? board.searchUrl ?? `https://${board.domain}` : "";

  const open = async () => {
    const done = await run("open", () => call("browser.signIn", url).then(() => true), "Browser opened. Sign in there, then close it.");
    if (done) {
      rememberSignedIn();
      void status.reload();
    }
  };
  const reset = async () => {
    const ok = await confirm({
      title: "Reset the agent's browser?",
      body: "It signs you out of every job board in the agent's browser and clears its cookies. Your own browser isn't touched.",
      confirmLabel: "Reset browser",
      danger: true,
    });
    if (ok) await run("reset", () => call("browser.resetProfile"), "Browser reset. Sign in to your boards again before the next run.");
  };

  return (
    <Section
      title="The agent's browser"
      description="The agent applies in a browser window of its own, with its own sign-ins, separate from the browser you use. Sign in to each job board there once and it stays signed in. The app never sees your passwords."
    >
      <div className="stack">
        <Segmented
          label="Browser"
          value={settings.browserChannel}
          onChange={(browserChannel) => save({ browserChannel }, `The agent will use ${browserChannel === "msedge" ? "Microsoft Edge" : "Google Chrome"}.`)}
          options={[
            { value: "chrome", label: "Google Chrome" },
            { value: "msedge", label: "Microsoft Edge" },
          ]}
          hint="It has to be installed. Edge comes with Windows."
        />
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <SelectField
            label="Sign in to"
            value={chosen}
            onChange={setTarget}
            options={list.map((b) => ({ value: b.domain, label: b.name }))}
            className="field-narrow"
          />
          <div className="row">
            <Button variant="primary" busy={busy === "open"} disabled={!url || !!current} onClick={open}>
              Open the browser
            </Button>
            {status.data?.open ? (
              <Button
                busy={busy === "close"}
                onClick={() =>
                  run("close", () => call("browser.close").then(() => status.reload()), "Browser closed.")
                }
              >
                Close it
              </Button>
            ) : null}
          </div>
        </div>
        {current ? <p className="muted" style={{ margin: 0 }}>The agent is using the browser now. Sign in when it has finished.</p> : null}
        <div>
          <Button variant="danger" small busy={busy === "reset"} disabled={!!current} onClick={reset}>
            Reset the agent's browser
          </Button>
        </div>
      </div>
    </Section>
  );
}

function RulesSection({ settings }: { settings: Settings }) {
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const { busy, run } = useAction();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(settings);
  }, [settings]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const save = async () => {
    const patch: Partial<Settings> = {
      approvalMode: draft.approvalMode,
      autoApplyThreshold: draft.autoApplyThreshold,
      minMatchScore: draft.minMatchScore,
      dailyApplicationLimit: draft.dailyApplicationLimit,
      maxApplicationsPerCampaign: draft.maxApplicationsPerCampaign,
      defaultStartDate: draft.defaultStartDate.trim() || "2 weeks notice",
      runTimeoutMinutes: draft.runTimeoutMinutes,
    };
    const saved = await run("rules", () => call("settings.update", patch), "Rules saved.");
    if (saved) {
      setDraft(saved);
      setDirty(false);
    }
  };
  const auto = draft.approvalMode === "auto";

  return (
    <Section
      title="When the agent may apply"
      description="The app enforces these itself. The agent can't send an application that breaks them."
      actions={
        <>
          <Button
            small
            disabled={!dirty}
            onClick={() => {
              setDraft(settings);
              setDirty(false);
            }}
          >
            Discard
          </Button>
          <Button small variant="primary" disabled={!dirty} busy={busy === "rules"} onClick={save}>
            Save rules
          </Button>
        </>
      }
    >
      <div className="stack">
        <Segmented
          label="Sending"
          value={draft.approvalMode}
          onChange={(value) => set("approvalMode", value)}
          options={[
            { value: "approve", label: "I approve every job first" },
            { value: "auto", label: "Send on its own above a score" },
          ]}
          hint={
            auto
              ? `Jobs scoring ${draft.autoApplyThreshold} or more go out without asking. The rest wait for you.`
              : "Nothing goes out until you approve it in the campaign."
          }
        />
        <div className="grid-3">
          {auto ? (
            <NumberField
              label="Auto-send score"
              value={draft.autoApplyThreshold}
              onChange={(v) => set("autoApplyThreshold", v ?? 80)}
              min={0}
              max={100}
              hint="Out of 100. Below this, jobs wait for you."
            />
          ) : null}
          <NumberField
            label="Lowest score to keep"
            value={draft.minMatchScore}
            onChange={(v) => set("minMatchScore", v ?? 60)}
            min={0}
            max={100}
            hint="Jobs scoring below this are skipped. Each campaign can set its own."
          />
          <NumberField
            label="Applications per day"
            value={draft.dailyApplicationLimit}
            onChange={(v) => set("dailyApplicationLimit", v ?? 25)}
            min={1}
            max={200}
            hint="Across all campaigns. Counts from midnight."
          />
          <NumberField
            label="Applications per campaign"
            value={draft.maxApplicationsPerCampaign}
            onChange={(v) => set("maxApplicationsPerCampaign", v)}
            min={1}
            max={500}
            placeholder="No limit"
            hint="The default for new campaigns. Leave empty for no limit."
          />
          <TextField
            label="When you can start"
            value={draft.defaultStartDate}
            onChange={(v) => set("defaultStartDate", v)}
            hint="What forms get when they ask, like “2 weeks notice” or “Immediately”."
          />
          <NumberField
            label="Longest run"
            value={draft.runTimeoutMinutes}
            onChange={(v) => set("runTimeoutMinutes", v ?? 180)}
            min={5}
            max={720}
            suffix="min"
            hint="A run still going after this is stopped."
          />
        </div>
      </div>
    </Section>
  );
}

function BoardsSection() {
  const boards = useRpc("boards.list", [], ["boards"]);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [searchUrl, setSearchUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const add = async () => {
    const cleanDomain = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!name.trim() || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleanDomain)) {
      setError("Give the board a name and its web address, like jobs.example.com.");
      return;
    }
    if (searchUrl.trim() && !/^https?:\/\//i.test(searchUrl.trim())) {
      setError("The search page link should start with https://.");
      return;
    }
    setError(null);
    const added = await run(
      "add",
      () => call("boards.add", { name: name.trim(), domain: cleanDomain, searchUrl: searchUrl.trim() || null }),
      "Board added.",
    );
    if (added) {
      setName("");
      setDomain("");
      setSearchUrl("");
    }
  };

  return (
    <Section title="Job boards" description="The boards campaigns can search. Add any site with a job search.">
      {!boards.data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Board</th>
                <th scope="col">Address</th>
                <th scope="col" className="actions-cell">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {boards.data.map((b) => (
                <tr key={b.domain}>
                  <td>
                    <span className="primary-text">{b.name}</span>
                    {b.builtin ? <span className="secondary-text">Built in</span> : null}
                  </td>
                  <td>{b.domain}</td>
                  <td className="actions-cell">
                    {!b.builtin ? (
                      <Button small variant="ghost" busy={busy === b.domain} onClick={() => run(b.domain, () => call("boards.remove", b.domain), "Board removed.")}>
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="grid-4"
        style={{ alignItems: "start", marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <TextField label="Name" value={name} onChange={setName} placeholder="Otta" />
        <TextField label="Web address" value={domain} onChange={setDomain} placeholder="otta.com" error={error} />
        <TextField label="Search page (optional)" value={searchUrl} onChange={setSearchUrl} placeholder="https://…" />
        <div style={{ paddingTop: 22 }}>
          <Button type="submit" busy={busy === "add"}>
            Add board
          </Button>
        </div>
      </form>
    </Section>
  );
}

function AnswersSection() {
  const answers = useRpc("answers.list", [], ["answers"]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const add = async () => {
    const cleanKey = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(cleanKey) || !value.trim()) {
      setError("Name the question in a few words, like notice period, and give the answer.");
      return;
    }
    setError(null);
    const saved = await run("add", () => call("answers.upsert", cleanKey, value.trim()), "Answer saved.");
    if (saved) {
      setKey("");
      setValue("");
    }
  };

  return (
    <Section
      title="Saved answers"
      description="Answers to form questions your profile doesn't cover. When you answer the agent and keep “Use this answer on future forms” ticked, it lands here."
    >
      {!answers.data ? (
        <Loading />
      ) : answers.data.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Answer</th>
                <th scope="col" className="actions-cell">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {answers.data.map((a) => {
                const draft = editing[a.key];
                return (
                  <tr key={a.key}>
                    <td className="nowrap">{a.key.replace(/_/g, " ")}</td>
                    <td style={{ width: "55%" }}>
                      {draft !== undefined ? (
                        <>
                          <label className="sr-only" htmlFor={`answer-${a.key}`}>
                            Answer for {a.key.replace(/_/g, " ")}
                          </label>
                          <input
                            id={`answer-${a.key}`}
                            className="input"
                            value={draft}
                            onChange={(event) => setEditing((all) => ({ ...all, [a.key]: event.target.value }))}
                          />
                        </>
                      ) : (
                        a.value
                      )}
                    </td>
                    <td className="actions-cell">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {draft !== undefined ? (
                          <>
                            <Button
                              small
                              variant="primary"
                              busy={busy === a.key}
                              disabled={!draft.trim()}
                              onClick={async () => {
                                const saved = await run(a.key, () => call("answers.upsert", a.key, draft.trim()), "Answer saved.");
                                if (saved) setEditing(({ [a.key]: _, ...rest }) => rest);
                              }}
                            >
                              Save
                            </Button>
                            <Button small variant="ghost" onClick={() => setEditing(({ [a.key]: _, ...rest }) => rest)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button small variant="ghost" onClick={() => setEditing((all) => ({ ...all, [a.key]: a.value }))}>
                              Edit
                            </Button>
                            <Button small variant="ghost" busy={busy === a.key} onClick={() => run(a.key, () => call("answers.remove", a.key), "Answer removed.")}>
                              Remove
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="grid-3"
        style={{ alignItems: "start", marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <TextField label="Question" value={key} onChange={setKey} placeholder="Notice period" error={error} />
        <TextField label="Answer" value={value} onChange={setValue} placeholder="One month" />
        <div style={{ paddingTop: 22 }}>
          <Button type="submit" busy={busy === "add"}>
            Add answer
          </Button>
        </div>
      </form>
    </Section>
  );
}

function DataSection({ busy }: { busy: string | null }) {
  const info = useRpc("app.info", [], []);
  const { run } = useAction();
  return (
    <Section title="Your data" description="Your CVs, profile, applications and the agent's browser profile live in one folder on this computer. Nothing is uploaded.">
      {info.data ? (
        <dl className="kv">
          <dt>Folder</dt>
          <dd>{info.data.dataDir}</dd>
          <dt>Version</dt>
          <dd>resumeapplyr {info.data.version}</dd>
          <dt>Credits</dt>
          <dd>
            The agent's skills build on JobPilot by Sukhrob Ilyosbekov and the humanizer skill by Siqi Chen, both MIT licensed. Type
            is Archivo, under the SIL Open Font License. The full notices are in THIRD_PARTY_NOTICES.md beside the app.
          </dd>
        </dl>
      ) : null}
      <div className="row" style={{ marginTop: 14 }}>
        <Button disabled={busy === "folder"} onClick={() => run("folder", () => call("shell.openDataFolder"))}>
          Open the folder
        </Button>
      </div>
    </Section>
  );
}
