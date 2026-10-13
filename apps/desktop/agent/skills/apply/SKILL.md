---
name: apply
description: Work through one campaign in the resumeapplyr app - score any pasted links still queued, then apply to the jobs the app clears (approved by the user, or auto-send above the user's score).
argument-hint: "campaign <campaign-id>"
---

<!-- Adapted from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License. -->

# Apply

Runs when the user presses **Score links** or **Apply to approved** on a campaign in the app.

## Setup

1. Follow `../_shared/setup.md` and read `../_shared/campaign-flow.md`.
2. The argument is `campaign <campaign-id>`. Anything else → stop with "Start this from a campaign
   in the app."
3. `GET /api/campaigns/<campaign-id>`: `CID`, `config.resumeId` as `RESUME_ID`, `config.minScore`
   as `MIN_SCORE` (absent → `autoApply.minMatchScore`).
4. From `GET /api/user` read `settings.approvalMode`, `settings.autoApplyThreshold` and
   `limits.remainingToday`.

## 1. Score queued links

When `summary.byStatus.queued > 0`, the campaign holds pasted links nobody has read yet:

```bash
resumeapplyr-api GET /api/campaigns/$CID/jobs --query status=queued --query limit=100
```

For each row, run the applied-check with the URL. On `.applied`, record `skipped` straight from
`queued` with `Already applied (<kind>)`.

Delegate the rest to `job-scorer` in batches of at most five, one batch at a time:

```json
{ "mode": "score", "campaignId": "<CID>", "save": "patch",
  "jobs": [{ "jobKey": "<key>", "url": "<url>" }],
  "minMatchScore": <MIN_SCORE>, "resumeId": "<RESUME_ID>" }
```

`save: "patch"` fills in the real title, company, score and brief on each row and moves it to
`pending`, or records it `skipped` when it isn't eligible.

## 2. Apply to what the app clears

Candidates, highest score first:

```bash
resumeapplyr-api GET /api/campaigns/$CID/jobs --query "status=approved,needs_user,pending" --query limit=100
```

- `approved` rows, and `needs_user` rows with `approvedBy` set: try each.
- `pending` rows: try only when `approvalMode` is `auto` and `matchScore` ≥ `autoApplyThreshold`.
  Otherwise they wait for the user.

For each candidate:

1. Run the applied-check again (the user may have applied elsewhere since).
2. `PATCH .../jobs/<key> {"status":"applying"}` and handle the response per the table in
   `../_shared/campaign-flow.md`.
3. On `200`, delegate to `job-applier` with the input from `../_shared/campaign-flow.md` (omit
   `brief`; the worker reads it from the saved job). One worker at a time.
4. Record the outcome per `../_shared/campaign-flow.md`. Wait 3-5 seconds before the next job.
5. Re-read the campaign; stop if it's paused, and stop on `429` or a campaign limit.

## 3. Finish

If nothing is left `queued`, `pending`, `approved` or `needs_user`, `POST
/api/campaigns/$CID/status {"status":"completed"}`. Report applied / failed / skipped counts, how
many wait for the user's approval, and why you stopped.

## Rules

The shared campaign rules (`../_shared/campaign-flow.md`) apply throughout.
