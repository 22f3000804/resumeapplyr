---
name: cover-letter
description: Write a short cover letter (150-250 words) for a job from the user's resume, in a plain human voice that doesn't repeat the user's recent letters.
argument-hint: "<job_description>"
---

<!-- Adapted from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License. -->

# Cover Letter

Write the letter a good candidate would write in fifteen minutes: short, specific, plain. The reader
should learn one or two real things about the candidate and want to talk to them.

## Setup

Follow `../_shared/setup.md`, then load the structured resume (the caller's `resumeId`, else
`user.primaryResumeId`):

```bash
resumeapplyr-api GET "/api/resumes/$RESUME_ID"
```

Write from its `content`. Don't `Read` the source PDF: it's the same content at several times the
size, and inside an apply loop that cost is paid per job.

## Step 1: Read the job

From the argument, note the company and what it does, the role and level, the two or three things
the job most needs, the stack and domain, and the tone (startup casual or enterprise formal).

## Step 2: Read your last five letters

Letters that are each fine but all the same shape are what reads as AI. Don't skip this.

```bash
resumeapplyr-api GET /api/cover-letters --query page=1 --query limit=5
```

The list is metadata only, so `GET /api/cover-letters/<id>` for each `.items[].id`. From each, keep
four things and drop the rest: what it led with, its first sentence, its last sentence, and how it
phrased its numbers. No history → skip to Step 3.

## Step 3: Choose what to say

Pick one lead, the strongest for this job:

- the result closest to their main need (for senior roles: scope, architecture, what the team
  shipped)
- direct experience with their stack, domain, or product (for research roles: publications)
- a real, specific reason for this company, only if the resume or JD gives you one

Don't lead with what either of the last two letters led with, unless the JD leaves no honest
alternative (a healthcare role wants the healthcare project).

Then pick one or two proof points that fit this job, not your two best overall: a named project or
role with one concrete detail each.

## Step 4: Write

**Header.** Values from `user.*` only, never the resume (resumes carry stale addresses). Drop any
line whose fields are empty:

```
[Full Name]
[City, Country] | [Phone] | [Email]
[LinkedIn] | [GitHub] | [Website]
```

**Body.** 150-250 words in three or four paragraphs of different lengths:

- **Open** with your lead in one to three sentences. Name the role somewhere in the letter, not
  necessarily first: "I'm applying for the X role at Y" is the opening every letter uses.
- **Proof** in one or two short paragraphs. Say what you did and what happened. Don't explain why
  it's relevant; if you picked well, the reader sees it.
- **Close** in one or two sentences: you'd like to talk. A thank-you is fine. No recap of fit.

Quote at most one short phrase from the JD. Write in first person as the candidate, only from resume
facts, in the company's tone.

**Sign-off:**

```
Best regards,
[Full Name]
```

## Step 5: Humanize and compare

Invoke the `humanizer` skill on the full letter in embedded mode.

Then compare against the Step 2 notes; the humanizer sees one letter and can't do this. Fix anything
that matches:

- no sentence reused, including how a metric is phrased (reuse the number, not the sentence)
- a different first and last sentence
- the company mentioned in a different place
- a different overall shape: if the last letters went intro, experience, tech, why-company, close,
  merge or drop a section

## Step 6: Save to history

Best effort; continue if it fails. Write `{"content":"<final letter>","jobUrl":"<job
url>","jobTitle":"<title>","company":"<company>","source":"<source>"}` to
`$RESUMEAPPLYR_TEMP/cover-letter.json`, omitting empty `jobUrl`/`jobTitle`/`company`:

```bash
resumeapplyr-api POST /api/cover-letters --data @"$RESUMEAPPLYR_TEMP/cover-letter.json"
```

Take `jobUrl`/`jobTitle`/`company` from the JD argument (`$BRIEF` fields when present). `source` is
the caller: `apply`, `auto_apply`, or `manual` (the default).

## Output

Plain text with the header and sign-off, ready to paste or render to PDF.
