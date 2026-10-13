// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
import type { ResumeBasics } from "../../src/core/schemas/resume";
import { findProfileMismatches, type ProfileContact } from "../../src/core/resume/consistency";
import { describe, expect, it } from "vitest";

const profile: ProfileContact = {
  city: "Portland",
  state: "ME",
  contactEmail: "sam@example.test",
  phone: "+1 857 867 1942",
  linkedin: "https://linkedin.com/in/sam",
  github: "https://github.com/sam",
  website: "https://sam.test",
};

const basics = (over: Partial<ResumeBasics> = {}): ResumeBasics => ({
  name: "Sam Doe",
  location: "Portland, ME",
  email: "sam@example.test",
  phone: "+1 857 867 1942",
  linkedin: "https://linkedin.com/in/sam",
  github: "https://github.com/sam",
  website: "https://sam.test",
  ...over,
});

describe("findProfileMismatches", () => {
  it("reports nothing when the resume agrees with the profile", () => {
    expect(findProfileMismatches(basics(), profile)).toEqual([]);
  });

  it("catches the real-world case: resume in one city, profile in another", () => {
    const found = findProfileMismatches(basics({ location: "Boston, MA" }), profile);
    expect(found).toEqual([{ field: "location", resume: "Boston, MA", profile: "Portland, ME" }]);
  });

  it("accepts location formats that still name the same place", () => {
    for (const location of [
      "Portland, Maine",
      "portland, me",
      "Greater Portland, ME",
      "Portland, ME, USA",
    ]) {
      expect(findProfileMismatches(basics({ location }), profile)).toEqual([]);
    }
  });

  it("ignores phone and email formatting differences", () => {
    const found = findProfileMismatches(
      basics({ phone: "(857) 867-1942", email: "Sam@Example.test" }),
      profile,
    );
    expect(found).toEqual([]);
  });

  it("ignores url scheme, www, and trailing slash differences", () => {
    const found = findProfileMismatches(
      basics({
        linkedin: "linkedin.com/in/sam",
        github: "https://www.github.com/sam/",
        website: "http://sam.test",
      }),
      profile,
    );
    expect(found).toEqual([]);
  });

  it("reports a genuinely different handle", () => {
    const found = findProfileMismatches(
      basics({ github: "https://github.com/someone-else" }),
      profile,
    );
    expect(found).toEqual([
      {
        field: "github",
        resume: "https://github.com/someone-else",
        profile: "https://github.com/sam",
      },
    ]);
  });

  it("treats an empty field on either side as a choice, not a conflict", () => {
    expect(findProfileMismatches(basics({ phone: "", location: undefined }), profile)).toEqual([]);
    expect(
      findProfileMismatches(basics(), { ...profile, phone: null, city: null, state: null }),
    ).toEqual([]);
  });

  it("returns nothing for a resume with no structured content", () => {
    expect(findProfileMismatches(undefined, profile)).toEqual([]);
  });

  it("reports every disagreeing field at once", () => {
    const found = findProfileMismatches(
      basics({ location: "Austin, TX", email: "old@example.test" }),
      profile,
    );
    expect(found.map((m) => m.field)).toEqual(["location", "email"]);
  });
});
