// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
// Deterministic scoring heuristic. `fit.ts` imports only `keyword-normalize` + a type, so no env/Prisma.

import { DEFAULT_MIN_MATCH_SCORE } from "../../src/core/schemas/settings";
import { scoreFit } from "../../src/core/scoring/fit";
import type { FitProfile, JobBrief } from "../../src/core/scoring/schema";
import { describe, expect, it } from "vitest";

const brief = (over: Partial<JobBrief>): JobBrief => ({
  title: "",
  company: "",
  skills: [],
  requirements: [],
  responsibilities: [],
  descriptionExcerpt: "",
  yearsExperience: null,
  ...over,
});

const profile = (over: Partial<FitProfile>): FitProfile => ({
  skills: [],
  yearsExperience: null,
  requiresSponsorship: false,
  ...over,
});

describe("scoreFit", () => {
  it("scores a perfect match at 100 with full confidence", () => {
    const result = scoreFit(
      brief({
        skills: ["react"],
        requirements: ["React experience required"],
        yearsExperience: 3,
      }),
      profile({ skills: ["react"], yearsExperience: 5 }),
    );
    // 0.5 skills + 0.2 years + 0.3 req-density, all maxed.
    expect(result.score).toBe(100);
    expect(result.confidence).toBe(1);
    expect(result.strongMatches).toEqual(["react"]);
    expect(result.gaps).toEqual([]);
    expect(result.verdict).toBe("trust");
  });

  it("marks unmatched brief skills as gaps and scores low", () => {
    const result = scoreFit(brief({ skills: ["rust", "go"] }), profile({ skills: ["react"] }));
    expect(result.strongMatches).toEqual([]);
    expect(result.gaps).toEqual(["rust", "go"]);
    expect(result.score).toBeLessThan(20);
  });

  it("matches through synonyms (js ↔ javascript)", () => {
    const result = scoreFit(brief({ skills: ["JavaScript"] }), profile({ skills: ["js"] }));
    expect(result.strongMatches).toEqual(["JavaScript"]);
    expect(result.gaps).toEqual([]);
  });

  it("rewards meeting the years requirement over falling short of it", () => {
    const base = brief({ skills: ["react"], yearsExperience: 7 });
    const meets = scoreFit(base, profile({ skills: ["react"], yearsExperience: 8 }));
    const shortOf = scoreFit(base, profile({ skills: ["react"], yearsExperience: 2 }));
    expect(meets.score).toBeGreaterThan(shortOf.score);
  });

  it("returns zero confidence when the brief has no skills, requirements, or years", () => {
    const result = scoreFit(brief({}), profile({ skills: ["react"] }));
    expect(result.confidence).toBe(0);
    expect(result.strongMatches).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it("matches multi-word profile terms at word level (.NET ↔ ASP.NET Core, SQL Server ↔ MS SQL)", () => {
    const result = scoreFit(
      brief({ skills: [".NET", "SQL Server", "AWS"] }),
      profile({ skills: ["ASP.NET Core", "MS SQL", "AWS (Amplify, S3, Lambda, Cognito)"] }),
    );
    expect(result.strongMatches).toEqual([".NET", "SQL Server", "AWS"]);
    expect(result.gaps).toEqual([]);
  });

  it("treats C# and C++ as different languages in both directions", () => {
    const csharpJob = scoreFit(brief({ skills: ["C#"] }), profile({ skills: ["C++"] }));
    expect(csharpJob.gaps).toEqual(["C#"]);
    expect(csharpJob.strongMatches).toEqual([]);

    const cppJob = scoreFit(brief({ skills: ["C++"] }), profile({ skills: ["C#"] }));
    expect(cppJob.gaps).toEqual(["C++"]);
    expect(cppJob.strongMatches).toEqual([]);
  });

  it("counts requirements hits for punctuated and multi-word terms", () => {
    const result = scoreFit(
      brief({
        skills: ["Node.js", "SQL Server"],
        requirements: ["Experience with Node.js", "SQL Server 2019 administration"],
      }),
      profile({}),
    );
    expect(result.partialMatches).toEqual(["Node.js", "SQL Server"]);
  });

  it("does not count a term against unrelated requirements text", () => {
    // "C#" used to compact to "c" and hit any requirement containing the letter.
    const result = scoreFit(
      brief({ skills: ["C#"], requirements: ["Strong communication skills"] }),
      profile({}),
    );
    expect(result.partialMatches).toEqual([]);
  });

  it("keeps the requirements-density term neutral when the brief has no requirements", () => {
    const result = scoreFit(
      brief({ skills: ["react"], yearsExperience: 3 }),
      profile({ skills: ["react"], yearsExperience: 5 }),
    );
    // 0.5 skills + 0.2 years + 0.3 neutral density - a thin brief must not cap at 70.
    expect(result.score).toBe(100);
  });

  it("caps confidence at 0.6 without requirements, under the trust bar", () => {
    const result = scoreFit(
      brief({ skills: ["react"], yearsExperience: 3 }),
      profile({ skills: ["react"], yearsExperience: 5 }),
    );
    expect(result.confidence).toBe(0.6);
    expect(result.verdict).toBe("deliberate");
  });
});

describe("scoreFit - verdict", () => {
  // Scores 75 at confidence 1: one strong match of two, both terms in the requirements, years met.
  const confidentBrief = brief({
    skills: ["react", "rust"],
    requirements: ["React and Rust experience"],
    yearsExperience: 3,
  });
  const confidentProfile = profile({ skills: ["react"], yearsExperience: 5 });

  it("deliberates when a confident score lands within the threshold margin", () => {
    const result = scoreFit(confidentBrief, confidentProfile, 70);
    expect(result.score).toBe(75);
    expect(result.confidence).toBe(1);
    expect(result.verdict).toBe("deliberate");
  });

  it("trusts the same score against a threshold far enough away", () => {
    const result = scoreFit(confidentBrief, confidentProfile, 40);
    expect(result.score).toBe(75);
    expect(result.verdict).toBe("trust");
  });

  it("falls back to the default threshold when none is passed", () => {
    const omitted = scoreFit(confidentBrief, confidentProfile);
    const explicit = scoreFit(confidentBrief, confidentProfile, DEFAULT_MIN_MATCH_SCORE);
    expect(omitted).toEqual(explicit);
  });
});

describe("scoreFit - eligibility", () => {
  const restricted = brief({
    skills: ["react"],
    descriptionExcerpt: "We are not able to provide visa sponsorship for this position.",
  });

  it("flags a stated sponsorship bar when the candidate needs sponsorship", () => {
    const result = scoreFit(restricted, profile({ requiresSponsorship: true }));
    expect(result.eligibilityBlocked?.kind).toBe("sponsorship");
    expect(result.eligibilityBlocked?.evidence).toContain("not able to provide visa sponsorship");
  });

  it("stays silent on sponsorship for a candidate who does not need it", () => {
    const result = scoreFit(restricted, profile({ requiresSponsorship: false }));
    expect(result.eligibilityBlocked).toBeUndefined();
  });

  it("reports a citizenship or clearance bar regardless of sponsorship need", () => {
    for (const requiresSponsorship of [true, false]) {
      const clearance = scoreFit(
        brief({ requirements: ["Active security clearance required"] }),
        profile({ requiresSponsorship }),
      );
      expect(clearance.eligibilityBlocked?.kind).toBe("clearance");

      const citizen = scoreFit(
        brief({ requirements: ["Must be a US citizen"] }),
        profile({ requiresSponsorship }),
      );
      expect(citizen.eligibilityBlocked?.kind).toBe("citizenship");
    }
  });

  it("leaves the fit score untouched, so the skip reason stays the real one", () => {
    const blocked = scoreFit(restricted, profile({ skills: ["react"], requiresSponsorship: true }));
    const open = scoreFit(restricted, profile({ skills: ["react"], requiresSponsorship: false }));
    // Ineligibility is reported, not disguised as a low score the user would try to fix.
    expect(blocked.score).toBe(open.score);
  });

  it("does not flag a posting that is merely silent on eligibility", () => {
    const result = scoreFit(
      brief({ skills: ["react"], descriptionExcerpt: "Senior React engineer. Remote." }),
      profile({ requiresSponsorship: true }),
    );
    expect(result.eligibilityBlocked).toBeUndefined();
  });

  it("reads requirements and responsibilities, not just the excerpt", () => {
    const result = scoreFit(
      brief({ responsibilities: ["No visa sponsorship is available."] }),
      profile({ requiresSponsorship: true }),
    );
    expect(result.eligibilityBlocked?.kind).toBe("sponsorship");
  });
});
