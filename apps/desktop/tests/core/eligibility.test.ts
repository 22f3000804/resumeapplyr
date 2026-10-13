// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
import { detectEligibilityRestrictions } from "../../src/core/scoring/eligibility";
import { describe, expect, it } from "vitest";

describe("detectEligibilityRestrictions", () => {
  // Verbatim from the postings that produced this user's sub-24h automated rejections.
  const realPhrases = [
    "Buzz Solutions does not provide Visa sponsorship for work authorizations in the United States at this time.",
    "CoStar Group is not able to provide visa sponsorship for this position.",
    "Cognizant will only consider applicants for this position who are legally authorized to work in the United States without company sponsorship.",
    "This role is not able to offer visa transfer or sponsorship now or in the future.",
    "We cannot accept EAD, OPT, or H1B candidates.",
    "No visa sponsorship is available for this role.",
    "Candidates must be authorized to work in the US without sponsorship.",
  ];

  it("catches every sponsorship phrasing seen in real postings", () => {
    for (const phrase of realPhrases) {
      expect(detectEligibilityRestrictions(phrase)).toEqual([
        { kind: "sponsorship", evidence: expect.any(String) },
      ]);
    }
  });

  it("separates a citizenship or clearance bar from a sponsorship one", () => {
    expect(detectEligibilityRestrictions("US citizenship required.")[0]?.kind).toBe("citizenship");
    expect(detectEligibilityRestrictions("Must be a US citizen.")[0]?.kind).toBe("citizenship");
    expect(detectEligibilityRestrictions("Active security clearance required.")[0]?.kind).toBe(
      "clearance",
    );
  });

  it("reports every kind a posting states, sponsorship first", () => {
    const found = detectEligibilityRestrictions(
      "Active security clearance required. No visa sponsorship. US citizenship required.",
    );
    // Sponsorship leads so a candidate who needs it reads the reason that actually applies.
    expect(found.map((restriction) => restriction.kind)).toEqual([
      "sponsorship",
      "citizenship",
      "clearance",
    ]);
  });

  it("quotes the posting's own sentence as evidence", () => {
    const found = detectEligibilityRestrictions(
      "We are hiring a backend engineer. CoStar Group is not able to provide visa sponsorship for this position. Benefits include dental.",
    );
    expect(found[0]?.evidence).toBe(
      "CoStar Group is not able to provide visa sponsorship for this position.",
    );
  });

  it("treats silence as unrestricted rather than guessing", () => {
    for (const text of [
      "Senior .NET engineer at a healthcare company. Competitive salary.",
      "We value diverse backgrounds and welcome applicants from everywhere.",
      "Visa sponsorship available for exceptional candidates.",
      "We sponsor H-1B and green cards.",
      "",
      undefined,
    ]) {
      expect(detectEligibilityRestrictions(text)).toEqual([]);
    }
  });

  it("searches across every supplied part", () => {
    expect(
      detectEligibilityRestrictions("Great role.", "5+ years experience", "No visa sponsorship."),
    ).toHaveLength(1);
  });

  it("truncates a run-on sentence rather than dumping a paragraph into a skip reason", () => {
    const long = `${"padding ".repeat(60)}no visa sponsorship${" more".repeat(60)}`;
    const evidence = detectEligibilityRestrictions(long)[0]?.evidence;
    expect(evidence!.length).toBeLessThanOrEqual(240);
    expect(evidence!.endsWith("…")).toBe(true);
  });
});
