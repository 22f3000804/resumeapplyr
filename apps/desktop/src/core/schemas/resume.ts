// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
// Changes: phone numbers are free text (no libphonenumber dependency).
import { z } from "zod";
import { normalizeLinkUrl } from "../url";

const linkUrl = z.string().transform(normalizeLinkUrl).optional();

const resumeBasicsSchema = z.object({
  name: z.string().min(1, "Required"),
  headline: z.string().optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().optional(),
  website: linkUrl,
  linkedin: linkUrl,
  github: linkUrl,
  location: z.string().optional(),
});

const resumeExperienceSchema = z.object({
  id: z.string().optional(),
  company: z.string().min(1, "Required"),
  title: z.string().min(1, "Required"),
  location: z.string().optional(),
  start: z.string(),
  end: z.string().optional(),
  bullets: z.array(z.string()),
});

const resumeProjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Required"),
  url: linkUrl,
  description: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  // Free text like experience dates. A project can only be promoted onto the experience timeline
  // when it has a real range, so these stay empty unless the CV states them.
  start: z.string().optional(),
  end: z.string().optional(),
});

const resumeSkillGroupSchema = z.object({
  id: z.string().optional(),
  group: z.string().min(1, "Required"),
  items: z.array(z.string()),
});

const resumeEducationSchema = z.object({
  id: z.string().optional(),
  school: z.string().min(1, "Required"),
  degree: z.string().min(1, "Required"),
  start: z.string().optional(),
  end: z.string().optional(),
  details: z.array(z.string()).default([]),
});

const resumePublicationSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Required"),
  authors: z.string().optional(),
  venue: z.string().optional(),
  year: z.string().optional(),
  url: linkUrl,
  doi: z.string().optional(),
});

const resumeAwardSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Required"),
  issuer: z.string().optional(),
  year: z.string().optional(),
  description: z.string().optional(),
});

const resumeCertificationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Required"),
  issuer: z.string().optional(),
  issued: z.string().optional(),
  expires: z.string().optional(),
  credentialId: z.string().optional(),
  url: linkUrl,
});

const resumeCustomEntrySchema = z.object({
  id: z.string().optional(),
  heading: z.string().min(1, "Required"),
  subheading: z.string().optional(),
  meta: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});

/** Anything the sections above don't model (grants, talks, languages, volunteering). */
const resumeCustomSectionSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Required"),
  entries: z.array(resumeCustomEntrySchema).default([]),
});

export const resumeDataSchema = z.object({
  basics: resumeBasicsSchema,
  summary: z.string().optional(),
  experience: z.array(resumeExperienceSchema).default([]),
  projects: z.array(resumeProjectSchema).default([]),
  skills: z.array(resumeSkillGroupSchema).default([]),
  education: z.array(resumeEducationSchema).default([]),
  publications: z.array(resumePublicationSchema).default([]),
  awards: z.array(resumeAwardSchema).default([]),
  certifications: z.array(resumeCertificationSchema).default([]),
  sections: z.array(resumeCustomSectionSchema).default([]),
});

export type ResumeData = z.infer<typeof resumeDataSchema>;
export type ResumeBasics = z.infer<typeof resumeBasicsSchema>;
export type ResumeExperience = z.infer<typeof resumeExperienceSchema>;
export type ResumeProject = z.infer<typeof resumeProjectSchema>;
export type ResumeSkillGroup = z.infer<typeof resumeSkillGroupSchema>;
export type ResumeEducation = z.infer<typeof resumeEducationSchema>;
export type ResumePublication = z.infer<typeof resumePublicationSchema>;
export type ResumeAward = z.infer<typeof resumeAwardSchema>;
export type ResumeCertification = z.infer<typeof resumeCertificationSchema>;
export type ResumeCustomSection = z.infer<typeof resumeCustomSectionSchema>;
export type ResumeCustomEntry = z.infer<typeof resumeCustomEntrySchema>;

export const EMPTY_RESUME_DATA: ResumeData = {
  basics: { name: "" },
  summary: "",
  experience: [],
  projects: [],
  skills: [],
  education: [],
  publications: [],
  awards: [],
  certifications: [],
  sections: [],
};

/** An agent-authored rewrite awaiting the user's accept or discard. */
export const SUGGESTED_REWRITE_LABEL = "Suggested rewrite";

/** Whether a variant label is reserved, and so exempt from reuse scoring. */
export function isProtectedVariantLabel(label: string): boolean {
  return label.startsWith(SUGGESTED_REWRITE_LABEL);
}

export const profileMismatchSchema = z.object({
  field: z.enum(["location", "email", "phone", "linkedin", "github", "website"]),
  resume: z.string(),
  profile: z.string(),
});

export type ProfileMismatch = z.infer<typeof profileMismatchSchema>;
