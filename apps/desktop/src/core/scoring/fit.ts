// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
import { DEFAULT_MIN_MATCH_SCORE } from "../schemas/settings";
import { detectEligibilityRestrictions, type EligibilityRestriction } from "./eligibility";
import {
  expandSynonyms,
  hasWholeToken,
  normalizeMatchPhrase,
  toSearchText,
} from "./keyword-normalize";
import type { FitProfile, JobBrief } from "./schema";

export interface FitResult {
  score: number;
  confidence: number;
  strongMatches: string[];
  partialMatches: string[];
  gaps: string[];
  /** "trust": use the score as-is; "deliberate": reason from the match evidence instead. */
  verdict: "trust" | "deliberate";
  /**
   * Set when the posting states a bar this candidate cannot clear. Kept out of `score` so a
   * 90-point skills match still reads as 90 and the skip reason stays the real one.
   */
  eligibilityBlocked?: EligibilityRestriction;
}

/** Below this the inputs are too thin for the score to stand on its own. */
const CONFIDENCE_TRUST_BAR = 0.7;

/** How far the score must sit from the threshold before the call is not a coin flip. */
const SCORE_THRESHOLD_MARGIN = 10;

// Words that carry meaning on their own inside a multi-word term ("net", "sql" - not "ms").
const WORD_MIN_LENGTH = 3;

const termWords = (term: string): string[] => {
  const words = normalizeMatchPhrase(term).split(" ");
  return words.length > 1 ? words.filter((w) => w.length >= WORD_MIN_LENGTH) : [];
};

/** Full-term variants plus word-level ones, so "ASP.NET Core" still matches a brief's ".NET". */
const termVariants = (term: string): string[] => {
  const variants = new Set(expandSynonyms(term));
  for (const word of termWords(term)) {
    for (const variant of expandSynonyms(word)) {
      variants.add(variant);
    }
  }
  return [...variants];
};

/**
 * Heuristic keyword-overlap fit score. Server-side, deterministic, no LLM.
 * The model uses this to skip full deliberation on confident high/low scores
 * and only reason about borderline cases.
 *
 * Weights:
 *   50% skills overlap (weighted Jaccard with synonyms)
 *   20% years-experience proximity
 *   30% keyword density in requirements
 */
export function scoreFit(
  brief: JobBrief,
  profile: FitProfile,
  minScore: number = DEFAULT_MIN_MATCH_SCORE,
): FitResult {
  const briefSkills = (brief.skills || []).filter(Boolean);
  const profileSkillsNormed = new Set<string>((profile.skills || []).flatMap(termVariants));

  const reqPhrase = normalizeMatchPhrase((brief.requirements || []).join(" "));
  const reqSearchText = toSearchText(reqPhrase);

  const strongMatches: string[] = [];
  const partialMatches: string[] = [];
  const gaps: string[] = [];
  let reqHits = 0;

  for (const term of briefSkills) {
    const variants = termVariants(term);
    const strong = variants.some((variant) => profileSkillsNormed.has(variant));
    if (strong) {
      strongMatches.push(term);
    } else {
      gaps.push(term);
    }

    if (variants.some((variant) => hasWholeToken(reqSearchText, variant))) {
      reqHits++;
      if (!strong && !partialMatches.includes(term)) {
        partialMatches.push(term);
      }
    }
  }

  const skillsOverlapScore =
    briefSkills.length === 0 ? 0 : strongMatches.length / briefSkills.length;
  let yearsScore = 0.5;

  if (
    brief.yearsExperience !== null &&
    brief.yearsExperience !== undefined &&
    profile.yearsExperience !== null
  ) {
    const gap = profile.yearsExperience! - brief.yearsExperience;
    if (gap >= 0) {
      yearsScore = 1;
    } else {
      yearsScore = Math.max(0, 1 + gap / 5);
    }
  }

  // No requirements text leaves the density neutral - a perfect skills match must not cap at 70.
  const reqDensityScore =
    briefSkills.length === 0 || reqPhrase.length === 0
      ? skillsOverlapScore
      : reqHits / briefSkills.length;
  const raw = skillsOverlapScore * 0.5 + yearsScore * 0.2 + reqDensityScore * 0.3;
  const score = Math.round(raw * 100);

  // A no-requirements brief tops out at 0.6, under CONFIDENCE_TRUST_BAR.
  let confidence = 0;
  if (briefSkills.length > 0) {
    confidence += 0.4;
  }
  if ((brief.requirements || []).length > 0) {
    confidence += 0.4;
  }
  if (brief.yearsExperience !== null && brief.yearsExperience !== undefined) {
    confidence += 0.2;
  }

  const restrictions = detectEligibilityRestrictions(
    brief.descriptionExcerpt,
    ...(brief.requirements ?? []),
    ...(brief.responsibilities ?? []),
  );
  // A sponsorship bar is only this candidate's problem when they need sponsorship; a stated
  // citizenship or clearance requirement bars anyone who lacks it, so it is never gated.
  const blocked = restrictions.find(
    (restriction) => restriction.kind !== "sponsorship" || profile.requiresSponsorship,
  );

  const roundedConfidence = Math.round(confidence * 100) / 100;
  const trusted =
    roundedConfidence >= CONFIDENCE_TRUST_BAR &&
    Math.abs(score - minScore) >= SCORE_THRESHOLD_MARGIN;

  return {
    score,
    confidence: roundedConfidence,
    strongMatches,
    partialMatches,
    gaps,
    verdict: trusted ? "trust" : "deliberate",
    ...(blocked && { eligibilityBlocked: blocked }),
  };
}
