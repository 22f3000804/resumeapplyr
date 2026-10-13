// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
// Every validator returns violations; empty means accepted. Tailoring may rephrase a real
// accomplishment but never fabricate, drop a fact, or pad it with stock phrasing.
import type { ResumeData } from "../schemas/resume";
import type { EntryRewriteAudit, TailorVariantBody } from "./schema";
import { type Corpus, droppedTerms, extractNumbers, unverifiedTerms } from "./facts";

/**
 * Stock resume phrasing that reads as machine-written. Matched whole-word, case-insensitive.
 * `plugin/skills/tailor-resume/SKILL.md` lists these so the agent avoids a 422; keep it in sync.
 */
const STOCK_PHRASES = [
  "comfortable with",
  "comfortable moving",
  "comfortable working",
  "hands-on",
  "hands on experience",
  "enjoys",
  "passionate",
  "results-driven",
  "results driven",
  "detail-oriented",
  "self-starter",
  "fast-paced",
  "track record",
  "cutting-edge",
  "state-of-the-art",
  "leverage",
  "leveraging",
  "spearheaded",
  "seasoned",
  "stakeholders",
  "business requirements",
  "production-grade",
  "best practices",
  "cross-functional",
  "end-to-end",
  "end to end",
  "picking up",
  "quick learner",
  "eager to",
  "thrives",
  "suited to",
  "the same",
  "downstream",
].map((phrase) => ({
  phrase,
  pattern: new RegExp(`(^|[^a-z])${phrase.replace(/[-.]/g, "\\$&")}([^a-z]|$)`),
}));

/** The stock phrases `text` uses. */
function stockPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return STOCK_PHRASES.filter(({ pattern }) => pattern.test(lower)).map(({ phrase }) => phrase);
}

/** Below this many content words a summary is a stub, and rewriting it is fine. */
const SUMMARY_STUB_WORDS = 8;
const SUMMARY_MIN_RETAINED = 0.5;
const SUMMARY_MAX_GROWTH = 1.25;
const SUMMARY_MAX_SENTENCES = 3;

function countSentences(text: string): number {
  return text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim()).length;
}

/** Lowercased words of four or more letters: the wording a light edit is expected to keep. */
function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4),
  );
}

/** Violations for a tailored summary. */
export function validateSummary(baseSummary: string, summary: string, corpus: Corpus): string[] {
  const violations: string[] = [];

  const stock = stockPhrases(summary);
  if (stock.length > 0) {
    violations.push(`summary uses stock phrasing (${stock.join(", ")}); say the specific thing.`);
  }
  const sentences = countSentences(summary);
  if (sentences > SUMMARY_MAX_SENTENCES) {
    violations.push(`summary has ${sentences} sentences; keep it to ${SUMMARY_MAX_SENTENCES}.`);
  }
  const newNumbers = [...extractNumbers(summary)].filter((n) => !corpus.numbers.has(n));
  if (newNumbers.length > 0) {
    violations.push(
      `summary introduces number(s) the resume never states (${newNumbers.join(", ")}).`,
    );
  }
  const unverified = unverifiedTerms(summary, corpus);
  if (unverified.length > 0) {
    violations.push(`summary names tech the resume never mentions (${unverified.join(", ")}).`);
  }

  const baseWords = contentWords(baseSummary);
  if (baseWords.size < SUMMARY_STUB_WORDS) {
    return violations;
  }
  const tailoredWords = contentWords(summary);
  const kept = [...baseWords].filter((word) => tailoredWords.has(word)).length;
  const retained = kept / baseWords.size;
  if (retained < SUMMARY_MIN_RETAINED) {
    violations.push(
      `summary keeps ${Math.round(retained * 100)}% of the base summary's wording; edit one or two sentences instead of rewriting it.`,
    );
  }
  if (summary.length > baseSummary.length * SUMMARY_MAX_GROWTH) {
    violations.push(
      `summary is ${summary.length} characters against ${baseSummary.length} in the base; it may grow by a quarter at most.`,
    );
  }
  return violations;
}

/** Violations for a retargeted headline. */
export function validateHeadline(headline: string, corpus: Corpus): string[] {
  const violations: string[] = [];
  const stock = stockPhrases(headline);
  if (stock.length > 0) {
    violations.push(`headline uses stock phrasing (${stock.join(", ")}).`);
  }
  const unverified = unverifiedTerms(headline, corpus);
  if (unverified.length > 0) {
    violations.push(`headline names tech the resume never mentions (${unverified.join(", ")}).`);
  }
  return violations;
}

type BulletRewrite = NonNullable<TailorVariantBody["bulletRewrites"]>[number];

interface RewriteValidation {
  /** Hard-guard failures. Non-empty ⇒ reject the whole request. */
  violations: string[];
  /** Per-entry audit of accepted rewrites. */
  audit: EntryRewriteAudit[];
  /** entryIndex → (trimmed original → tailored), for applying in `tailorBase`. */
  map: Map<number, Map<string, string>>;
}

const BULLET_MAX_GROWTH = 1.4;

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function bulletProblem(original: string, tailored: string, corpus: Corpus): string | null {
  const originalNumbers = extractNumbers(original);
  const tailoredNumbers = extractNumbers(tailored);
  const added = [...tailoredNumbers].filter((n) => !originalNumbers.has(n));
  if (added.length > 0) {
    return `introduces number(s) not in the original (${added.join(", ")})`;
  }
  const dropped = [...originalNumbers].filter((n) => !tailoredNumbers.has(n));
  if (dropped.length > 0) {
    return `drops number(s) the original stated (${dropped.join(", ")})`;
  }
  const unverified = unverifiedTerms(tailored, corpus);
  if (unverified.length > 0) {
    return `names tech the resume never mentions (${unverified.join(", ")})`;
  }
  const droppedTech = droppedTerms(original, tailored);
  if (droppedTech.length > 0) {
    return `drops tech the original named (${droppedTech.join(", ")})`;
  }
  const stock = stockPhrases(tailored);
  if (stock.length > 0) {
    return `uses stock phrasing (${stock.join(", ")})`;
  }
  if (tailored.length > original.length * BULLET_MAX_GROWTH) {
    return `grows from ${original.length} to ${tailored.length} characters; a reword may not add clauses`;
  }
  return null;
}

/**
 * `experience[].bullets` on the base is the master set. Any failure rejects the whole request: the
 * original must be a real bullet of an existing entry, rewritten once, and pass `bulletProblem`.
 */
export function validateRewrites(
  base: ResumeData,
  rewrites: BulletRewrite[],
  corpus: Corpus,
): RewriteValidation {
  const violations: string[] = [];
  const audit: EntryRewriteAudit[] = [];
  const map = new Map<number, Map<string, string>>();
  const experience = base.experience ?? [];

  for (const { entryIndex, bullets } of rewrites) {
    const entry = experience[entryIndex];
    if (!entry) {
      violations.push(`Experience entry ${entryIndex} does not exist.`);
      continue;
    }

    const { company } = entry;
    const masterSet = new Set((entry.bullets ?? []).map((b) => b.trim()));
    const entryMap = new Map<string, string>();

    for (const pair of bullets) {
      const original = pair.original.trim();
      const tailored = pair.tailored.trim();

      if (!tailored) {
        violations.push(`${company}: empty tailored bullet for "${truncate(original)}".`);
      } else if (!masterSet.has(original)) {
        violations.push(
          `${company}: original bullet not found in the base resume: "${truncate(original)}".`,
        );
      } else if (entryMap.has(original)) {
        violations.push(`${company}: bullet rewritten more than once: "${truncate(original)}".`);
      } else {
        const problem = bulletProblem(original, tailored, corpus);
        if (problem) {
          violations.push(`${company}: reworded bullet ${problem}: "${truncate(tailored)}".`);
        } else {
          entryMap.set(original, tailored);
        }
      }
    }

    if (entryMap.size > 0) {
      map.set(entryIndex, entryMap);
      audit.push({
        entryIndex,
        company,
        bullets: [...entryMap].map(([original, tailored]) => ({ original, tailored })),
      });
    }
  }

  return { violations, audit, map };
}
