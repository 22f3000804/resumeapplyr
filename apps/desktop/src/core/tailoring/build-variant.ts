// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
import type { ResumeData } from "../schemas/resume";
import { unprocessable } from "../errors";
import type { TailorVariantBody, VariantRewriteAudit } from "./schema";
import { buildCorpus } from "./facts";
import { validateHeadline, validateRewrites, validateSummary } from "./guards";
import { tailorBase } from "./rank";
import { applyStructure } from "./structure";

interface TailoredVariant {
  content: ResumeData;
  /** Null when nothing was reworded or restructured. */
  audit: VariantRewriteAudit | null;
  rewordedBullets: number;
  flags: string[];
}

/** Restructure, validate rewrites against the *restructured* entries, then rank. */
export function buildTailoredVariant(base: ResumeData, body: TailorVariantBody): TailoredVariant {
  // All-or-nothing: a partially-applied restructure is a resume nobody asked for.
  const structure = body.structure ? applyStructure(base, body.structure) : null;
  if (structure && !structure.ok) {
    throw unprocessable("Structure validation failed", structure.violations);
  }

  const restructured = structure?.content ?? base;
  const corpus = buildCorpus(restructured);
  const summary = body.summary?.trim();
  const headline = body.headline?.trim();
  const rewrites = validateRewrites(restructured, body.bulletRewrites ?? [], corpus);
  // One throw for every field, so a bad summary and a bad bullet cost one round trip.
  const violations = [
    ...(summary ? validateSummary(restructured.summary ?? "", summary, corpus) : []),
    ...(headline ? validateHeadline(headline, corpus) : []),
    ...rewrites.violations,
  ];
  if (violations.length > 0) {
    throw unprocessable("Tailor validation failed", violations);
  }

  const rewordedBullets = rewrites.audit.reduce((n, entry) => n + entry.bullets.length, 0);
  const structureAudit = structure?.audit;
  const changed = rewordedBullets > 0 || structureAudit;

  return {
    content: tailorBase(restructured, body, rewrites.map),
    audit: changed ? { experience: rewrites.audit, structure: structureAudit } : null,
    rewordedBullets,
    flags: structureAudit?.flags ?? [],
  };
}
