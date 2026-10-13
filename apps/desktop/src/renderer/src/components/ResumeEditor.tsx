// Edits a CV's structured content, section by section, with the printed result alongside.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_RESUME_DATA, type ResumeData, resumeDataSchema } from "../../../core/schemas/resume";
import type { ResumeDetail } from "../../../shared/types";
import { call } from "../api";
import { ResumePreview } from "./ResumePreview";
import { Button, Field, TextAreaField, TextField, useAction } from "./ui";

type Kind = "text" | "textarea" | "lines" | "comma";

interface FieldDef {
  key: string;
  label: string;
  kind?: Kind;
  span?: 1 | 2 | 3;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

type Entry = Record<string, unknown>;

const SECTION_NAMES: Record<string, string> = {
  basics: "Name and contact",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  awards: "Awards",
  publications: "Publications",
  sections: "Other sections",
};

const FIELD_NAMES: Record<string, string> = {
  name: "name",
  company: "company",
  title: "title",
  school: "school",
  degree: "degree",
  group: "group name",
  heading: "heading",
  email: "email",
};

/** Fills in any sections an older or agent-written CV leaves out, so every list exists. */
function complete(content: ResumeData | null): ResumeData {
  return { ...EMPTY_RESUME_DATA, ...(content ?? {}), basics: { ...EMPTY_RESUME_DATA.basics, ...(content?.basics ?? {}) } };
}

/** Drops the blank lines and list items the editor keeps while someone is typing. */
function clean(data: ResumeData): ResumeData {
  const list = (value: unknown) => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []);
  return {
    ...data,
    experience: data.experience.map((e) => ({ ...e, bullets: list(e.bullets) })),
    education: data.education.map((e) => ({ ...e, details: list(e.details) })),
    skills: data.skills.map((s) => ({ ...s, items: list(s.items) })),
    projects: data.projects.map((p) => ({ ...p, bullets: list(p.bullets), keywords: list(p.keywords) })),
    sections: data.sections.map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, bullets: list(e.bullets) })) })),
  };
}

/** Turns a schema issue's path into words: "Experience 2 needs a company". */
function describeIssue(path: PropertyKey[], message: string): string {
  const where: string[] = [];
  let field = "";
  path.forEach((segment, i) => {
    if (typeof segment === "number") return;
    const key = String(segment);
    const next = path[i + 1];
    if (typeof next === "number") where.push(`${SECTION_NAMES[key] ?? (key === "entries" ? "entry" : key)} ${next + 1}`);
    else if (i === 0) where.push(SECTION_NAMES[key] ?? key);
    else field = FIELD_NAMES[key] ?? key;
  });
  const place = where.join(", ");
  if (/required|too small|>=\s*1/i.test(message) && field) return `${place} needs ${/^[aeiou]/i.test(field) ? "an" : "a"} ${field}`;
  return `${place}${field ? `, ${field}` : ""}: ${message}`;
}

export function ResumeEditor({ resume }: { resume: ResumeDetail }) {
  const [draft, setDraft] = useState<ResumeData>(() => complete(resume.content));
  const [label, setLabel] = useState(resume.label);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const seenVersion = useRef(resume.version);
  const { busy, run } = useAction();

  // Someone else (the agent, another tab of the app) saved a newer version.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (resume.version <= seenVersion.current) return;
    seenVersion.current = resume.version;
    if (dirtyRef.current) {
      setStale(true);
    } else {
      setDraft(complete(resume.content));
      setLabel(resume.label);
    }
  }, [resume.version, resume.content, resume.label]);

  const update = (next: ResumeData) => {
    setDraft(next);
    setDirty(true);
  };
  const cleaned = useMemo(() => clean(draft), [draft]);
  const issues = useMemo(() => {
    const result = resumeDataSchema.safeParse(cleaned);
    return result.success ? [] : result.error.issues.map((i) => describeIssue(i.path, i.message));
  }, [cleaned]);

  const save = async () => {
    if (issues.length) {
      setShowIssues(true);
      return;
    }
    const saved = await run("save", () => call("resumes.update", resume.id, { label: label.trim() || resume.label, content: cleaned }), "CV saved.");
    if (saved) {
      seenVersion.current = saved.version;
      setDraft(complete(saved.content));
      setLabel(saved.label);
      setDirty(false);
      setStale(false);
      setShowIssues(false);
    }
  };
  const discard = () => {
    setDraft(complete(resume.content));
    setLabel(resume.label);
    setDirty(false);
    setStale(false);
    setShowIssues(false);
  };

  const set = <K extends keyof ResumeData>(key: K, value: ResumeData[K]) => update({ ...draft, [key]: value });
  const basics = draft.basics;
  const setBasic = (key: keyof ResumeData["basics"], value: string) => update({ ...draft, basics: { ...basics, [key]: value } });

  return (
    <div className="editor-layout">
      <div>
        <div className="editor-bar">
          <span className="status" aria-live="polite">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button disabled={!dirty} onClick={discard}>
            Discard changes
          </Button>
          <Button variant="primary" disabled={!dirty && label === resume.label} busy={busy === "save"} onClick={save}>
            Save CV
          </Button>
        </div>

        {stale ? (
          <div className="notice notice-accent">
            <p>This CV changed somewhere else while you were editing. Saving now replaces that version with yours.</p>
            <div className="row">
              <Button small onClick={discard}>
                Load the new version instead
              </Button>
            </div>
          </div>
        ) : null}

        {showIssues && issues.length ? (
          <div className="notice notice-accent" role="alert">
            <p className="notice-title">Fix these before saving</p>
            <ul>
              {issues.slice(0, 8).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <TextField
          label="What you call this CV"
          value={label}
          onChange={(value) => {
            setLabel(value);
            setDirty(true);
          }}
          hint="Only you see this. Useful when you keep one CV per kind of role."
          maxLength={120}
        />

        <section className="editor-section" aria-label={SECTION_NAMES.basics}>
          <h3>{SECTION_NAMES.basics}</h3>
          <div className="grid-2">
            <TextField label="Full name" value={basics.name ?? ""} onChange={(v) => setBasic("name", v)} required />
            <TextField label="Headline" value={basics.headline ?? ""} onChange={(v) => setBasic("headline", v)} placeholder="Senior product designer" />
            <TextField label="Email" type="email" value={basics.email ?? ""} onChange={(v) => setBasic("email", v)} />
            <TextField label="Phone" type="tel" value={basics.phone ?? ""} onChange={(v) => setBasic("phone", v)} />
            <TextField label="Location" value={basics.location ?? ""} onChange={(v) => setBasic("location", v)} placeholder="Berlin, Germany" />
            <TextField label="Website" value={basics.website ?? ""} onChange={(v) => setBasic("website", v)} />
            <TextField label="LinkedIn" value={basics.linkedin ?? ""} onChange={(v) => setBasic("linkedin", v)} />
            <TextField label="GitHub" value={basics.github ?? ""} onChange={(v) => setBasic("github", v)} />
          </div>
        </section>

        <section className="editor-section" aria-label={SECTION_NAMES.summary}>
          <h3>{SECTION_NAMES.summary}</h3>
          <TextAreaField
            label="A few lines at the top"
            value={draft.summary ?? ""}
            onChange={(v) => set("summary", v)}
            rows={4}
            hint="Optional. Many good CVs skip it."
          />
        </section>

        <EntryList
          section="experience"
          items={draft.experience as unknown as Entry[]}
          onChange={(items) => set("experience", items as unknown as ResumeData["experience"])}
          blank={{ title: "", company: "", location: "", start: "", end: "", bullets: [] }}
          addLabel="Add a role"
          itemLabel={(e) => [e.title, e.company].filter(Boolean).join(", ") || "New role"}
          fields={[
            { key: "title", label: "Job title", required: true },
            { key: "company", label: "Company", required: true },
            { key: "location", label: "Location" },
            { key: "start", label: "Started", placeholder: "Mar 2021" },
            { key: "end", label: "Ended", placeholder: "Present" },
            { key: "bullets", label: "What you did", kind: "lines", span: 3, hint: "One point per line. Lead with results and numbers where you have them." },
          ]}
        />

        <EntryList
          section="education"
          items={draft.education as unknown as Entry[]}
          onChange={(items) => set("education", items as unknown as ResumeData["education"])}
          blank={{ degree: "", school: "", start: "", end: "", details: [] }}
          addLabel="Add education"
          itemLabel={(e) => [e.degree, e.school].filter(Boolean).join(", ") || "New entry"}
          fields={[
            { key: "degree", label: "Degree or course", required: true },
            { key: "school", label: "School", required: true },
            { key: "start", label: "Started" },
            { key: "end", label: "Finished" },
            { key: "details", label: "Details", kind: "lines", span: 3, hint: "Optional. One per line: grade, thesis, honours." },
          ]}
        />

        <EntryList
          section="skills"
          items={draft.skills as unknown as Entry[]}
          onChange={(items) => set("skills", items as unknown as ResumeData["skills"])}
          blank={{ group: "", items: [] }}
          addLabel="Add a skill group"
          itemLabel={(e) => String(e.group || "New group")}
          fields={[
            { key: "group", label: "Group", required: true, placeholder: "Design tools" },
            { key: "items", label: "Skills in this group", kind: "comma", span: 2, placeholder: "Figma, Prototyping, Design systems" },
          ]}
        />

        <EntryList
          section="projects"
          items={draft.projects as unknown as Entry[]}
          onChange={(items) => set("projects", items as unknown as ResumeData["projects"])}
          blank={{ name: "", url: "", description: "", bullets: [], keywords: [], start: "", end: "" }}
          addLabel="Add a project"
          itemLabel={(e) => String(e.name || "New project")}
          fields={[
            { key: "name", label: "Name", required: true },
            { key: "url", label: "Link" },
            { key: "start", label: "Started" },
            { key: "description", label: "One-line description", span: 2 },
            { key: "end", label: "Ended" },
            { key: "bullets", label: "Details", kind: "lines", span: 3 },
            { key: "keywords", label: "Tools and keywords", kind: "comma", span: 3 },
          ]}
        />

        <EntryList
          section="certifications"
          items={draft.certifications as unknown as Entry[]}
          onChange={(items) => set("certifications", items as unknown as ResumeData["certifications"])}
          blank={{ name: "", issuer: "", issued: "", expires: "", credentialId: "", url: "" }}
          addLabel="Add a certification"
          itemLabel={(e) => String(e.name || "New certification")}
          fields={[
            { key: "name", label: "Name", required: true },
            { key: "issuer", label: "Issued by" },
            { key: "issued", label: "Issued" },
            { key: "expires", label: "Expires" },
            { key: "credentialId", label: "Credential ID" },
            { key: "url", label: "Link" },
          ]}
        />

        <EntryList
          section="awards"
          items={draft.awards as unknown as Entry[]}
          onChange={(items) => set("awards", items as unknown as ResumeData["awards"])}
          blank={{ title: "", issuer: "", year: "", description: "" }}
          addLabel="Add an award"
          itemLabel={(e) => String(e.title || "New award")}
          fields={[
            { key: "title", label: "Award", required: true },
            { key: "issuer", label: "From" },
            { key: "year", label: "Year" },
            { key: "description", label: "Description", kind: "textarea", span: 3 },
          ]}
        />

        <EntryList
          section="publications"
          items={draft.publications as unknown as Entry[]}
          onChange={(items) => set("publications", items as unknown as ResumeData["publications"])}
          blank={{ title: "", authors: "", venue: "", year: "", url: "", doi: "" }}
          addLabel="Add a publication"
          itemLabel={(e) => String(e.title || "New publication")}
          fields={[
            { key: "title", label: "Title", required: true, span: 2 },
            { key: "year", label: "Year" },
            { key: "authors", label: "Authors", span: 2 },
            { key: "venue", label: "Published in" },
            { key: "url", label: "Link", span: 2 },
            { key: "doi", label: "DOI" },
          ]}
        />

        <EntryList
          section="sections"
          items={draft.sections as unknown as Entry[]}
          onChange={(items) => set("sections", items as unknown as ResumeData["sections"])}
          blank={{ title: "", entries: [] }}
          addLabel="Add a section"
          description="Anything the sections above don't cover: languages, talks, volunteering, grants."
          itemLabel={(e) => String(e.title || "New section")}
          fields={[{ key: "title", label: "Section heading", required: true, span: 3, placeholder: "Languages" }]}
          renderExtra={(entry, change) => (
            <EntryList
              section="entries"
              nested
              items={(entry.entries as Entry[] | undefined) ?? []}
              onChange={(entries) => change({ ...entry, entries })}
              blank={{ heading: "", subheading: "", meta: "", bullets: [] }}
              addLabel="Add an entry"
              itemLabel={(e) => String(e.heading || "New entry")}
              fields={[
                { key: "heading", label: "Heading", required: true },
                { key: "subheading", label: "Subheading" },
                { key: "meta", label: "Date or detail" },
                { key: "bullets", label: "Details", kind: "lines", span: 3 },
              ]}
            />
          )}
        />
      </div>

      <div className="preview-col">
        <ResumePreview target={{ content: cleaned }} debounceMs={350} caption="Updates as you type. Save to keep your changes." />
      </div>
    </div>
  );
}

function EntryList({
  section,
  items,
  onChange,
  blank,
  fields,
  addLabel,
  itemLabel,
  description,
  nested,
  renderExtra,
}: {
  section: string;
  items: Entry[];
  onChange: (items: Entry[]) => void;
  blank: Entry;
  fields: FieldDef[];
  addLabel: string;
  itemLabel: (entry: Entry) => string;
  description?: string;
  nested?: boolean;
  renderExtra?: (entry: Entry, change: (entry: Entry) => void) => ReactNode;
}) {
  const replace = (index: number, entry: Entry) => onChange(items.map((item, i) => (i === index ? entry : item)));
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  };
  const body = (
    <>
      {items.map((entry, index) => (
        <div className="entry" key={(entry.id as string | undefined) ?? `${section}-${index}`}>
          <div className="entry-head">
            <span className="label">{itemLabel(entry)}</span>
            <div className="row">
              <Button small variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${itemLabel(entry)} up`}>
                Up
              </Button>
              <Button
                small
                variant="ghost"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${itemLabel(entry)} down`}
              >
                Down
              </Button>
              <Button small variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={`Remove ${itemLabel(entry)}`}>
                Remove
              </Button>
            </div>
          </div>
          <div className="grid-3">
            {fields.map((field) => (
              <EntryField key={field.key} field={field} entry={entry} onChange={(value) => replace(index, { ...entry, [field.key]: value })} />
            ))}
          </div>
          {renderExtra ? <div style={{ marginTop: 14 }}>{renderExtra(entry, (next) => replace(index, next))}</div> : null}
        </div>
      ))}
      <div className="row" style={{ marginTop: items.length ? 12 : 0 }}>
        <Button small onClick={() => onChange([...items, { ...blank }])}>
          {addLabel}
        </Button>
      </div>
    </>
  );
  if (nested) return body;
  return (
    <section className="editor-section" aria-label={SECTION_NAMES[section] ?? section}>
      <h3>{SECTION_NAMES[section] ?? section}</h3>
      {description ? <p className="field-hint" style={{ marginTop: -6, marginBottom: 12 }}>{description}</p> : null}
      {body}
    </section>
  );
}

function EntryField({ field, entry, onChange }: { field: FieldDef; entry: Entry; onChange: (value: unknown) => void }) {
  const className = field.span === 3 ? "span-all" : field.span === 2 ? "span-2" : undefined;
  const label = field.label;
  const value = entry[field.key];
  if (field.kind === "lines" || field.kind === "comma") {
    return (
      <ListField
        label={label}
        hint={field.hint}
        className={className}
        value={Array.isArray(value) ? value.map(String) : []}
        onChange={onChange}
        separator={field.kind}
        placeholder={field.placeholder}
      />
    );
  }
  if (field.kind === "textarea") {
    return (
      <TextAreaField label={label} hint={field.hint} className={className} value={typeof value === "string" ? value : ""} onChange={onChange} rows={3} />
    );
  }
  return (
    <TextField
      label={label}
      hint={field.hint}
      className={className}
      value={typeof value === "string" ? value : ""}
      onChange={onChange}
      placeholder={field.placeholder}
      required={field.required}
    />
  );
}

/** A list edited as text: one item per line, or comma-separated. Keeps what's typed as typed. */
function ListField({
  label,
  hint,
  className,
  value,
  onChange,
  separator,
  placeholder,
}: {
  label: string;
  hint?: string;
  className?: string;
  value: string[];
  onChange: (value: string[]) => void;
  separator: "lines" | "comma";
  placeholder?: string;
}) {
  const parse = (text: string) => (separator === "lines" ? text.split("\n") : text.split(",").map((part, i) => (i === 0 ? part : part.replace(/^ /, ""))));
  const format = (list: string[]) => list.join(separator === "lines" ? "\n" : ", ");
  const [text, setText] = useState(() => format(value));
  useEffect(() => {
    const ours = parse(text).map((s) => s.trim()).filter(Boolean);
    const theirs = value.map((s) => s.trim()).filter(Boolean);
    // Only an outside change (load, discard, reorder) replaces what's being typed.
    if (JSON.stringify(ours) !== JSON.stringify(theirs)) setText(format(value));
  }, [value]);
  const handle = (next: string) => {
    setText(next);
    onChange(parse(next));
  };
  if (separator === "lines") {
    return (
      <Field label={label} hint={hint} className={className}>
        {({ id, describedBy }) => (
          <textarea
            id={id}
            className="input"
            rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
            value={text}
            placeholder={placeholder}
            aria-describedby={describedBy}
            onChange={(event) => handle(event.target.value)}
          />
        )}
      </Field>
    );
  }
  return <TextField label={label} hint={hint} className={className} value={text} onChange={handle} placeholder={placeholder} />;
}
