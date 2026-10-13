// Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License,
// Copyright (c) 2026 Sukhrob Ilyosbekov. See THIRD_PARTY_NOTICES.md.
// A recruiter reads the resume's contact block; the ATS row comes from the profile. They should agree.
import type { ResumeBasics } from "../schemas/resume";
import type { z } from "zod";
import type { profileMismatchSchema } from "../schemas/resume";

export interface ProfileContact {
  city: string | null;
  state: string | null;
  contactEmail: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
}

type ProfileMismatch = z.infer<typeof profileMismatchSchema>;

function loose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looseUrl(value: string): string {
  return loose(
    value
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, ""),
  );
}

/** Minus a NANP country code: "+1 857…" and "(857)…" are the same phone. */
function loosePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** "Portland, Maine" and "Greater Portland, ME" both agree with city=Portland. */
function locationAgrees(resume: string, city: string | null, state: string | null): boolean {
  // City is load-bearing: "MA" alone is inside "Massachusetts" but also "Amsterdam".
  const anchor = city?.trim() || state?.trim();
  return !anchor || loose(resume).includes(loose(anchor));
}

/** A field absent from either side is a choice, not a conflict. */
export function findProfileMismatches(
  basics: ResumeBasics | undefined,
  profile: ProfileContact,
): ProfileMismatch[] {
  if (!basics) {
    return [];
  }

  const mismatches: ProfileMismatch[] = [];
  const profileLocation = [profile.city, profile.state].filter(Boolean).join(", ");

  if (
    basics.location?.trim() &&
    profileLocation &&
    !locationAgrees(basics.location, profile.city, profile.state)
  ) {
    mismatches.push({ field: "location", resume: basics.location, profile: profileLocation });
  }

  // Per-field comparison: a plain string compare flags every "+1" and "https://" as a conflict.
  const checks = [
    { field: "email", resume: basics.email, profile: profile.contactEmail, normalize: loose },
    { field: "phone", resume: basics.phone, profile: profile.phone, normalize: loosePhone },
    { field: "linkedin", resume: basics.linkedin, profile: profile.linkedin, normalize: looseUrl },
    { field: "github", resume: basics.github, profile: profile.github, normalize: looseUrl },
    { field: "website", resume: basics.website, profile: profile.website, normalize: looseUrl },
  ] as const;

  for (const check of checks) {
    if (!check.resume?.trim() || !check.profile?.trim()) {
      continue;
    }
    if (check.normalize(check.resume) !== check.normalize(check.profile)) {
      mismatches.push({ field: check.field, resume: check.resume, profile: check.profile });
    }
  }

  return mismatches;
}
