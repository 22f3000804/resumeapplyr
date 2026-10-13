// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
// Pure data + string helpers - no env/Prisma. Imported directly from the module files.

import { normalizeKeyword, normalizeMatchPhrase } from "../../src/core/scoring/keyword-normalize";
import { SYNONYM_GROUPS } from "../../src/core/scoring/synonyms.data";
import { describe, expect, it } from "vitest";

describe("SYNONYM_GROUPS", () => {
  it("gives every group at least two spellings", () => {
    const tooSmall = SYNONYM_GROUPS.filter((group) => group.length < 2);
    expect(tooSmall).toEqual([]);
  });

  it("keeps every entry meaningful after normalization", () => {
    const bad = SYNONYM_GROUPS.flat().filter((entry) => {
      const compact = normalizeKeyword(entry);
      return compact.length < 2 || normalizeMatchPhrase(entry).length === 0;
    });
    expect(bad).toEqual([]);
  });

  it("never repeats a compact form across groups", () => {
    // A shared compact form silently merges two professions' vocabularies into one expansion.
    // Deduping within a group first makes any survivor a cross-group collision.
    const compacts = SYNONYM_GROUPS.flatMap((group) => [...new Set(group.map(normalizeKeyword))]);

    expect(compacts.filter((compact, i) => compacts.indexOf(compact) !== i)).toEqual([]);
  });
});
