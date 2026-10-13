---
name: auto-apply
description: Search a job board and apply to matching jobs one at a time, within what the user allows in the app (approve-first or auto-send above a score, a daily limit), until paused, exhausted or capped.
argument-hint: "<query> --board <domain> --campaign <campaign-id>"
---

<!-- Adapted from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License. -->

# Auto-apply

Keep the board open in tab 1. For each result that qualifies, ask the app for clearance to apply
(the move to `applying`); when it's granted, hand the job to the `job-applier` subagent, record the
outcome and move on. When it isn't, the job waits in the app for the user's approval.

## Setup

1. Follow `../_shared/setup.md` and read `../_shared/campaign-flow.md` - especially "The app
   decides what may be sent".
2. Flags: `--board <domain>` and `--campaign <campaign-id>`, both required. The rest is the query.
3. `GET /api/campaigns/<campaign-id>`: `CID`, `config.resumeId` as `RESUME_ID` (absent → the
   primary), `config.minScore` as `MIN_SCORE` (absent → `autoApply.minMatchScore`, default 60).
4. Read `settings.approvalMode`, `settings.autoApplyThreshold` and `limits.remainingToday` from
   `GET /api/user`. If `remainingToday` is 0, say the daily limit is already reached and stop.
5. Resolve the board from `GET /api/job-boards`; none → command the campaign `failed` (see `search`)
   and stop.

## 1. Open the board (tab 1)

1. `browser_navigate` to `searchUrl`. This tab stays open for the whole campaign.
2. Check the sign-in state per `../_shared/auth.md`.
3. Search with the query as written, then read the results per `../_shared/browser-tips.md`.

## 2. The loop

Walk the results top to bottom, scrolling or paging for more per **Pagination & infinite scroll**.
For each result:

### 2.1 Dedupe (no tab)

Skip in-board repeats by title + company. Run the applied-check; on `.applied` save the job as
`pending` and record `skipped` with `Already applied (<kind>)`. Don't open a tab.

### 2.2 Score

Build the brief from the results row, `POST /api/score-fit` with `{brief, minScore: MIN_SCORE,
resumeId}`. `trust` → use the score; `deliberate` → reason from the matches and gaps. A row too
thin to judge → delegate it to `job-scorer` (`mode:"score"`, `jobs:[{jobKey, url}]`, `campaignId`,
`resumeId`, `minMatchScore: MIN_SCORE`); it saves the job, and eligible rows stay `pending`.

- Below `MIN_SCORE` after a fair read → save `pending`, then `skipped` with `Below minimum match
  score (<score> < <MIN_SCORE>)`.
- Blocked by eligibility (`../_shared/eligibility.md`) → save, then skip with that reason.
- Otherwise save it `pending` with `matchScore`, `matchReason`, `brief` and `description`.

### 2.3 Ask for clearance

```bash
resumeapplyr-api PATCH /api/campaigns/$CID/jobs/<key> --data '{"status":"applying"}'
```

Handle the response exactly as the table in `../_shared/campaign-flow.md` says. `403` is normal in
approve-first mode: the job now waits for the user, so count it as "waiting for approval" and go
to the next result. `429` or a paused or capped campaign ends the loop.

### 2.4 Apply (delegate to `job-applier`)

Only after a `200`. Delegate with the `job-applier` input from `../_shared/campaign-flow.md`,
passing the brief from 2.2. One worker at a time; wait for its result.

### 2.5 Record and continue

Re-select tab 0 (the worker closed its own tabs). Map the outcome to a `/result` write, or
`needs_user` to a PATCH, per `../_shared/campaign-flow.md`. Wait 3-5 seconds before the next
result.

### 2.6 Stop when

Re-read the campaign before each result (`GET /api/campaigns/$CID`):

1. `status: "paused"` → stop (record any job you were in the middle of as `skipped`, `Campaign
   paused by user`).
2. The app refused with `429`, a campaign limit or a paused campaign.
3. The board is exhausted (two scrolls in a row add nothing).

## 3. Finish

If nothing is left `pending`, `approved` or `needs_user`, `POST /api/campaigns/$CID/status
{"status":"completed"}`; otherwise leave the campaign as it is. Then report:

```
Applied to <a>. <w> are waiting for your approval in the app. Skipped <s>, failed <f>.
```

Name the stop reason (daily limit, paused, board exhausted). When jobs wait for approval, tell the
user to approve them in the app and press **Apply to approved**.

## Rules

The shared campaign rules (`../_shared/campaign-flow.md`) apply throughout. On top of them:

1. The app's clearance is the only permission to apply. Never open a form without a `200` on the
   move to `applying`.
2. The board stays in tab 1; each application runs in the worker's own tab.
3. A missing CV file → `POST /api/campaigns/$CID/status {"status":"paused","reason":"CV file
   missing"}` and stop.
