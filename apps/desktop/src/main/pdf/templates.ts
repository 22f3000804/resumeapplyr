// HTML for the PDFs the app produces. Printed by Chromium (printToPDF), so what you see in the
// app's preview is exactly what gets uploaded. Single column, standard headings, real text: the
// layout ATS parsers read reliably. Structure follows JobPilot's "Jake" resume template (MIT).
import type {
  ResumeAward,
  ResumeBasics,
  ResumeCertification,
  ResumeCustomEntry,
  ResumeData,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  ResumePublication,
} from "../../core/schemas/resume";

export type PaperSize = "A4" | "Letter";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string | undefined | null): string {
  return (value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** Only http(s) and mailto links survive; anything else renders as plain text. */
function safeHref(raw: string): string | null {
  const href = /^(https?:|mailto:)/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function link(raw: string, label = raw.replace(/^https?:\/\//, "").replace(/\/$/, "")): string {
  const href = safeHref(raw);
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

export function dateRange(start?: string, end?: string): string {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s && !e) return "";
  if (s && !e) return `${s} – Present`;
  if (!s) return e;
  return `${s} – ${e}`;
}

function contactBar(basics: ResumeBasics): string {
  const parts: string[] = [];
  if (basics.location) parts.push(escapeHtml(basics.location));
  if (basics.phone) parts.push(escapeHtml(basics.phone));
  if (basics.email) parts.push(link(`mailto:${basics.email}`, basics.email));
  for (const url of [basics.linkedin, basics.github, basics.website]) {
    if (url) parts.push(link(url));
  }
  return parts.length ? `<p class="contact">${parts.join('<span class="sep">|</span>')}</p>` : "";
}

const bullets = (items: string[] | undefined) =>
  items && items.length
    ? `<ul>${items.map((b) => `<li>${escapeHtml(b.replace(/^[•▪–-]\s*/, ""))}</li>`).join("")}</ul>`
    : "";

function entry(title: string, right: string, sub?: string, subRight?: string, body = ""): string {
  return `<div class="entry">
  <div class="row"><span class="title">${title}</span>${right ? `<span class="right">${right}</span>` : ""}</div>
  ${sub ? `<div class="row sub"><span>${sub}</span>${subRight ? `<span>${subRight}</span>` : ""}</div>` : ""}
  ${body}
</div>`;
}

const section = (title: string, body: string) => (body ? `<h2>${escapeHtml(title)}</h2>${body}` : "");

const experience = (e: ResumeExperience) =>
  entry(escapeHtml(e.company), escapeHtml(dateRange(e.start, e.end)), escapeHtml(e.title), escapeHtml(e.location), bullets(e.bullets));

function project(p: ResumeProject): string {
  const keywords = p.keywords.join(", ");
  const showDescription =
    !!p.description && p.description.trim().toLowerCase() !== keywords.trim().toLowerCase();
  const right = [p.url ? link(p.url) : "", escapeHtml(dateRange(p.start, p.end))].filter(Boolean).join(" · ");
  const body = `${keywords ? `<p class="keywords">${escapeHtml(keywords)}</p>` : ""}${
    showDescription ? `<p class="note">${escapeHtml(p.description)}</p>` : ""
  }${bullets(p.bullets)}`;
  return entry(escapeHtml(p.name), right, undefined, undefined, body);
}

const education = (e: ResumeEducation) =>
  entry(
    escapeHtml(e.school),
    escapeHtml(dateRange(e.start, e.end)),
    escapeHtml(e.degree),
    undefined,
    e.details.length ? `<div class="details">${e.details.map((d) => `<p>${escapeHtml(d)}</p>`).join("")}</div>` : "",
  );

function publication(p: ResumePublication): string {
  const href = p.doi ? `https://doi.org/${p.doi.replace(/^doi:\s*/i, "")}` : p.url;
  const body = `${p.venue ? `<p class="note">${escapeHtml(p.venue)}</p>` : ""}${href ? `<p>${link(href, p.doi ?? undefined)}</p>` : ""}`;
  return entry(escapeHtml(p.title), escapeHtml(p.year), escapeHtml(p.authors), undefined, body);
}

const award = (a: ResumeAward) =>
  entry(escapeHtml(a.title), escapeHtml(a.year), escapeHtml(a.issuer), undefined, a.description ? `<p class="note">${escapeHtml(a.description)}</p>` : "");

const certification = (c: ResumeCertification) =>
  entry(
    escapeHtml(c.name),
    escapeHtml(dateRange(c.issued ?? "", c.expires)),
    escapeHtml(c.issuer),
    undefined,
    c.credentialId ? `<p class="note">${escapeHtml(c.credentialId)}</p>` : "",
  );

const custom = (e: ResumeCustomEntry) =>
  entry(escapeHtml(e.heading), escapeHtml(e.meta), escapeHtml(e.subheading), undefined, bullets(e.bullets));

const RESUME_CSS = (paper: PaperSize) => `
@page { size: ${paper}; margin: 13mm 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Helvetica, Arial, "Liberation Sans", sans-serif; font-size: 10pt; color: #111; line-height: 1.34; -webkit-print-color-adjust: exact; }
p { margin: 0; }
a { color: #1f4ea8; text-decoration: none; }
.name { font-size: 21pt; line-height: 1.15; font-weight: 700; text-align: center; letter-spacing: .4pt; }
.headline { margin-top: 2pt; text-align: center; font-size: 11.5pt; color: #444; }
.contact { margin-top: 6pt; text-align: center; font-size: 9.3pt; color: #222; }
.contact .sep { margin: 0 5pt; color: #888; }
h2 { margin: 11pt 0 3pt; padding-bottom: 1.5pt; border-bottom: .75pt solid #000; font-size: 10.6pt; font-weight: 700; text-transform: uppercase; letter-spacing: .5pt; break-after: avoid; }
.summary { margin-top: 5pt; text-align: justify; }
.entry { margin-top: 5.5pt; break-inside: avoid; }
.row { display: flex; justify-content: space-between; gap: 10pt; }
.title { font-weight: 700; font-size: 10.4pt; }
.right { font-weight: 700; white-space: nowrap; }
.sub { margin-top: 1pt; font-style: italic; font-size: 9.6pt; }
ul { margin: 2.5pt 0 0; padding-left: 13pt; }
li { margin-top: 1.4pt; text-align: justify; }
.keywords { margin-top: 1pt; font-size: 9.4pt; color: #333; }
.note { margin-top: 1.5pt; font-style: italic; }
.details p { margin-top: 1.5pt; }
.skills p { margin-top: 2pt; }
.skills b { margin-right: 3pt; }
`;

/** A complete HTML document for one CV. Every value from the CV is escaped. */
export function renderResumeHtml(data: ResumeData, paper: PaperSize = "A4"): string {
  const skills = data.skills.length
    ? `<div class="skills">${data.skills
        .map((g) => `<p><b>${escapeHtml(g.group)}:</b>${escapeHtml(g.items.join(", "))}</p>`)
        .join("")}</div>`
    : "";
  const educationFirst = data.experience.length === 0;
  const educationBlock = section("Education", data.education.map(education).join(""));

  const body = [
    `<p class="name">${escapeHtml(data.basics.name) || "&nbsp;"}</p>`,
    data.basics.headline?.trim() ? `<p class="headline">${escapeHtml(data.basics.headline)}</p>` : "",
    contactBar(data.basics),
    data.summary?.trim() ? section("Summary", `<p class="summary">${escapeHtml(data.summary)}</p>`) : "",
    educationFirst ? educationBlock : "",
    section("Experience", data.experience.map(experience).join("")),
    section("Projects", data.projects.map(project).join("")),
    educationFirst ? "" : educationBlock,
    section("Skills", skills),
    section("Publications", data.publications.map(publication).join("")),
    section("Awards", data.awards.map(award).join("")),
    section("Certifications", data.certifications.map(certification).join("")),
    ...data.sections.map((s) => section(s.title, s.entries.map(custom).join(""))),
  ].join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
    data.basics.name || "CV",
  )}</title><style>${RESUME_CSS(paper)}</style></head><body>${body}</body></html>`;
}

/** The cover-letter skill's plain text on one page, keeping its line breaks and paragraph gaps. */
export function renderCoverLetterHtml(text: string, paper: PaperSize = "A4"): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const body = lines
    .map((line) => (line.trim() === "" ? '<div class="gap"></div>' : `<p>${escapeHtml(line)}</p>`))
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cover letter</title><style>
@page { size: ${paper}; margin: 19mm 22mm; }
body { margin: 0; font-family: Helvetica, Arial, "Liberation Sans", sans-serif; font-size: 11pt; line-height: 1.5; color: #111; }
p { margin: 0; } .gap { height: 8pt; }
</style></head><body>${body}</body></html>`;
}
