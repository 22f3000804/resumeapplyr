<!-- Adapted from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License. -->
# Campaign flow - shared mechanics and rules

The steps every campaign skill shares (`search`, `auto-apply`, `apply`). Load the profile and CV
per `./setup.md` first; each skill states only what it does differently.

## The app decides what may be sent

The user chooses in the app how much the agent may do on its own, and the app enforces it:

- **Approve-first** (`settings.approvalMode: "approve"`): you find and score jobs and save them as
  `pending`. The user approves them in the app. You may apply only to jobs that are `approved`.
- **Auto-send** (`"auto"`): you may also apply on your own to jobs whose saved `matchScore` is at
  least `settings.autoApplyThreshold`. Lower scores stay `pending` for the user.
- A **daily limit** (`limits.remainingToday`), an optional per-campaign cap, pausing, and the
  duplicate check apply in both modes.

All of it is checked at one step: moving a job to `applying`. **Always do that move before you open
an application form, and only open the form when it succeeds.** A refusal is the answer, not a
glitch:

| Response to `PATCH .../jobs/<key> {"status":"applying"}` | Meaning | Do |
| --- | --- | --- |
| `200` | Cleared | Apply |
| `403` | Needs the user's approval | Leave it `pending`; go to the next job |
| `409` "Already applied" | Duplicate; the app recorded the skip | Next job, never retry |
| `409` paused / finished / campaign limit | Stop applying | End the loop |
| `429` | Daily limit reached | End the loop; say so in the summary |

## Applied-check (dedupe before opening a tab)

```bash
resumeapplyr-api GET /api/applied/check --query "url=<job-url>" --query "title=<title>" --query "company=<company>"
```

Exact URL match at any age, or fuzzy title+company within 30 days; `.match.kind` is `url` or
`fuzzy`. On `.applied`: save the job as `pending`, then POST its `/result` with
`{"outcome":"skipped","skipReason":"Already applied (<kind>)"}` and move on without opening a tab.

## Saving jobs

```bash
resumeapplyr-api POST /api/campaigns/$CID/jobs --data @"$RESUMEAPPLYR_TEMP/job-<key>.json"
```

Body: `{ key, title, company, location, url, board, matchScore, matchReason, status: "pending",
brief, description }` - `brief` as a JSON string (`./job-brief.md`), `description` the posting text
when you read it. `key` is stable and shell-safe (a slug of `company-title`). New jobs are only ever
`queued` or `pending`. A `409` means the key is already in the campaign.

Non-terminal moves go through `PATCH /api/campaigns/$CID/jobs/<key>` (`pending` → `approved` in
auto-send, → `applying`, → `needs_user`). Field updates (`matchScore`, `matchReason`, `brief`,
`title`, ...) go through the same PATCH.

## Terminal results

A finished job gets ONE call - `POST /api/campaigns/$CID/jobs/<key>/result` - which updates the job
and, on `applied`, records the application. `appliedAt` is the current UTC time, ISO 8601
(`node -p "new Date().toISOString()"`):

```jsonc
// applied - name the CV that was uploaded; send resumeVariantId whenever a tailored variant went in
{ "outcome": "applied", "appliedAt": "<now>", "matchScore": <0-100>, "resumeId": "<id>", "resumeVariantId": "<id>" }
// failed (unexpected page, validation error, crash)
{ "outcome": "failed", "failReason": "<what happened>", "retryNotes": "<what to try next time>" }
// skipped (duplicate, not eligible, CAPTCHA, user declined)
{ "outcome": "skipped", "skipReason": "<why>" }
```

**Always send `resumeId` on `applied`, and `resumeVariantId` whenever a variant was uploaded** - it
is the only record of what the user actually sent.

## job-applier input

```json
{ "campaignId": "<CID>", "jobKey": "<key>", "url": "<job-url>", "board": "<domain>",
  "brief": <brief or null>, "resumeId": "<RESUME_ID>", "salaryExpectation": null }
```

The job must already be `applying`. The worker loads the profile and saved answers itself, can ask
the user directly (`./asking-the-user.md`), and returns `applied` / `failed` / `skipped` /
`needs_user`. It closes its tabs before returning: re-select tab 0, then:

- `applied` / `failed` / `skipped` → the terminal `/result` write above.
- `needs_user` (a question nobody answered) → `PATCH .../jobs/<key> {"status":"needs_user"}` so the
  user can answer later and the job can be retried; move on.

## Rules

1. **Never skip silently.** Every `skipped` write carries a non-empty `skipReason`.
2. **The campaign is the audit trail.** PATCH non-terminal moves; POST `/result` for outcomes, so
   the app shows what really happened.
3. **Never pay for anything.** A form asking for payment → `failed` with `"Payment required"`.
4. **CAPTCHAs and sign-ins are the user's** (`./auth.md`). Never try to get around one.
5. **Eligibility** follows `./eligibility.md`.
6. **Pace**: wait 3-5 seconds between submissions on the same site.
7. **Be honest about match scores**: label stretches as stretches.
8. **One worker at a time**: the browser is shared.
9. **Re-read the campaign between jobs** (`GET /api/campaigns/$CID`): `status: "paused"` means stop.
