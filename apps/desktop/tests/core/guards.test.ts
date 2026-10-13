// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
import type { ResumeData } from "../../src/core/schemas/resume";
import { buildCorpus } from "../../src/core/tailoring/facts";
import { base, NLP_BULLET, PIPELINE_BULLET } from "./fakes";
import { validateHeadline, validateRewrites, validateSummary } from "../../src/core/tailoring/guards";
import { describe, expect, it } from "vitest";

const summaryViolations = (data: ResumeData, summary: string) =>
  validateSummary(data.summary ?? "", summary, buildCorpus(data));

const headlineViolations = (data: ResumeData, headline: string) =>
  validateHeadline(headline, buildCorpus(data));

describe("validateSummary", () => {
  it("accepts a light edit that swaps one sentence", () => {
    const violations = summaryViolations(
      base(),
      "Machine learning engineer who takes models from research question to production service. Trained in computer vision and multimodal learning, with published work in medical imaging, on top of nine years of building software that people depend on. Recent work is clinical NLP under HIPAA.",
    );

    expect(violations).toEqual([]);
  });

  it("refuses a rewrite that keeps little of the base wording", () => {
    const violations = summaryViolations(
      base(),
      "Data scientist with nine years building production ML and analytics systems, including predictive models over millions of records and statistical forecasting. Applied-math background.",
    );

    expect(violations.some((v) => v.includes("% of the base summary"))).toBe(true);
  });

  it("names every stock phrase it finds", () => {
    const violations = summaryViolations(
      base(),
      "Machine learning engineer comfortable with PyTorch who enjoys solving practical problems and picking up new techniques quickly.",
    );

    const stock = violations.find((v) => v.includes("stock phrasing")) ?? "";
    expect(stock).toContain("comfortable with");
    expect(stock).toContain("enjoys");
    expect(stock).toContain("picking up");
  });

  it("refuses a number the resume never states", () => {
    const violations = summaryViolations(
      base(),
      "Machine learning engineer who takes models from research question to production service across 12 launches. Trained in computer vision and multimodal learning, with published work in medical imaging, on top of nine years of building software.",
    );

    expect(violations.some((v) => v.includes("12"))).toBe(true);
  });

  it("refuses tech the resume never mentions", () => {
    const violations = summaryViolations(
      base(),
      "Machine learning engineer who takes models from research question to production service on GCP. Trained in computer vision and multimodal learning, with published work in medical imaging, on top of nine years of building software.",
    );

    expect(violations.some((v) => v.includes("GCP"))).toBe(true);
  });

  it("caps the summary at three sentences", () => {
    const violations = summaryViolations(
      base(),
      "Machine learning engineer. Takes models from research question to production service. Trained in computer vision and multimodal learning with published work in medical imaging. Nine years of building software that people depend on.",
    );

    expect(violations.some((v) => v.includes("4 sentences"))).toBe(true);
  });

  it("lets a stub summary be rewritten freely", () => {
    const stub = { ...base(), summary: "Engineer." };

    expect(summaryViolations(stub, "Machine learning engineer focused on clinical NLP.")).toEqual(
      [],
    );
  });
});

describe("validateHeadline", () => {
  it("accepts a plain title", () => {
    expect(headlineViolations(base(), "Senior Machine Learning Engineer")).toEqual([]);
  });

  it("refuses stock phrasing and unknown tech", () => {
    const violations = headlineViolations(base(), "Seasoned GCP Engineer");

    expect(violations).toHaveLength(2);
  });
});

function rewrite(entryIndex: number, original: string, tailored: string) {
  const data = base();
  return validateRewrites(
    data,
    [{ entryIndex, bullets: [{ original, tailored }] }],
    buildCorpus(data),
  );
}

describe("validateRewrites", () => {
  it("accepts a reword that keeps every fact and only changes the lead", () => {
    const result = rewrite(
      0,
      NLP_BULLET,
      "Clinical NLP pipeline extracting symptoms, medications, and care events from free-text notes; 0.90 F1.",
    );

    expect(result.violations).toEqual([]);
    expect(result.audit[0].bullets[0]).toEqual({
      original: NLP_BULLET,
      tailored:
        "Clinical NLP pipeline extracting symptoms, medications, and care events from free-text notes; 0.90 F1.",
    });
  });

  it("refuses a reword that drops the tech the original named", () => {
    const result = rewrite(
      1,
      PIPELINE_BULLET,
      "Built a real-time feature and automated retraining pipeline for forecasting models, running nightly.",
    );

    expect(result.violations[0]).toContain("drops tech");
    expect(result.violations[0]).toContain("SignalR");
  });

  it("refuses a reword that drops a number the original stated", () => {
    const result = rewrite(
      0,
      NLP_BULLET,
      "NLP pipeline extracting symptoms, medications, and care events from clinical notes with F1 measured.",
    );

    expect(result.violations[0]).toContain("drops number");
  });

  it("refuses a reword that adds a clause", () => {
    const result = rewrite(
      0,
      NLP_BULLET,
      `Biomedical ${NLP_BULLET} Results fed a clinical decision-support workflow used by the care team daily.`,
    );

    expect(result.violations[0]).toContain("grows from");
  });

  it("refuses stock phrasing", () => {
    const result = rewrite(
      0,
      NLP_BULLET,
      "Hands-on NLP pipeline extracting symptoms, medications, and care events from clinical notes; 0.90 F1.",
    );

    expect(result.violations[0]).toContain("stock phrasing");
    expect(result.violations[0]).toContain("hands-on");
  });

  it("rejects tech the resume never mentions instead of flagging it", () => {
    const result = rewrite(
      0,
      NLP_BULLET,
      "NLP pipeline on GCP extracting symptoms, medications, and care events from clinical notes; 0.90 F1.",
    );

    expect(result.violations[0]).toContain("GCP");
  });

  it("accepts tech attested elsewhere in the resume", () => {
    const result = rewrite(
      0,
      NLP_BULLET,
      "HIPAA NLP pipeline extracting symptoms, medications, and care events from clinical notes; 0.90 F1.",
    );

    expect(result.violations).toEqual([]);
  });
});
