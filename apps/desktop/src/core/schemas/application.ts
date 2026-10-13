// Adapted from JobPilot's application contracts (https://github.com/suxrobgm/jobpilot), MIT License.
import { z } from "zod";

export const APPLICATION_STATUSES = [
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_SOURCES = ["apply", "auto_apply", "search", "manual"] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const createApplicationSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).optional(),
  board: z.string().trim().max(200).optional(),
  appliedAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateApplicationSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
  note: z.string().max(2000).optional(),
});

export const QUESTION_KINDS = [
  "signin", // sign in or register on a site, in the open browser window
  "verification", // a 2FA or email code
  "captcha", // a CAPTCHA the user has to solve in the browser
  "question", // a form question only the user can answer
  "choice", // the same, with options
  "salary",
  "review", // look over a filled form before it is submitted
] as const;

export const createQuestionSchema = z.object({
  kind: z.enum(QUESTION_KINDS),
  question: z.string().trim().min(1).max(500),
  context: z.string().trim().max(2000).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  /** A short snake_case name when the answer fits other forms too, so it's saved and reused. */
  answerKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,40}$/)
    .optional(),
  campaignId: z.string().optional(),
  jobKey: z.string().optional(),
  url: z.url().optional(),
});
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const answerQuestionSchema = z.object({
  answer: z.string().trim().max(2000),
  /** Remember the answer under the question's answerKey for future forms. */
  remember: z.boolean().default(true),
});

export const coverLetterSchema = z.object({
  content: z.string().trim().min(1).max(10000),
  jobUrl: z.url().optional(),
  jobTitle: z.string().trim().max(300).optional(),
  company: z.string().trim().max(300).optional(),
  source: z.enum(["apply", "auto_apply", "manual"]).default("manual"),
});

export const savedAnswerSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,40}$/),
  value: z.string().trim().min(1).max(2000),
});
