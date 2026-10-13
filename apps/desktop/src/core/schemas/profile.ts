import { z } from "zod";
import { normalizeLinkUrl } from "../url";

const text = (max = 200) => z.string().trim().max(max).default("");
const link = z.string().trim().max(300).transform(normalizeLinkUrl).default("");

export const SALARY_PERIODS = ["yearly", "monthly", "hourly"] as const;

const salaryPreferenceSchema = z.object({
  /** What kind of role this range is for, e.g. "Senior design roles" or "Any". */
  appliesTo: z.string().trim().min(1).max(120),
  minAmount: z.number().nonnegative().nullable().default(null),
  maxAmount: z.number().nonnegative().nullable().default(null),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code like GBP, EUR, USD or INR"),
  period: z.enum(SALARY_PERIODS),
});

const referenceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: text(120),
  company: text(120),
  email: z.union([z.literal(""), z.email()]).default(""),
  phone: text(40),
});

const NOT_DISCLOSED = "Prefer not to disclose";
const eeo = z.string().trim().max(120).default(NOT_DISCLOSED);

/**
 * What application forms ask for. Field names follow JobPilot's profile so the ported form-filling
 * guidance maps one to one, with US-only fields generalised (`authorizedToWorkIn` instead of
 * `usAuthorized`).
 */
export const profileSchema = z.object({
  firstName: text(80),
  lastName: text(80),
  contactEmail: z.union([z.literal(""), z.email()]).default(""),
  phone: text(40),
  website: link,
  linkedin: link,
  github: link,

  street: text(),
  aptUnit: text(60),
  city: text(80),
  state: text(80),
  zipCode: text(20),
  country: text(80),

  /** Countries the user can work in without sponsorship. */
  authorizedToWorkIn: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  requiresSponsorship: z.boolean().default(false),
  visaStatus: text(120),
  willingToRelocate: z.boolean().default(false),
  /** Empty, or containing "Anywhere", means open to any location. */
  preferredLocations: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  salaryPreferences: z.array(salaryPreferenceSchema).max(5).default([]),
  references: z.array(referenceSchema).max(3).default([]),

  eeoGender: eeo,
  eeoRace: eeo,
  eeoEthnicity: eeo,
  eeoHispanicOrLatino: eeo,
  eeoVeteranStatus: eeo,
  eeoDisabilityStatus: eeo,
});

export type Profile = z.infer<typeof profileSchema>;
export type SalaryPreference = z.infer<typeof salaryPreferenceSchema>;

export const EMPTY_PROFILE: Profile = profileSchema.parse({});

/** The fields an application cannot go out without. */
export function missingProfileFields(profile: Profile): string[] {
  const missing: string[] = [];
  if (!profile.firstName) missing.push("first name");
  if (!profile.lastName) missing.push("last name");
  if (!profile.contactEmail) missing.push("contact email");
  if (!profile.phone) missing.push("phone");
  return missing;
}
