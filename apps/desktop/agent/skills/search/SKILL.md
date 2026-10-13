---
name: search
description: Search one job board in the browser, score every result against the user's CV, and save the results to the campaign for the user to review in the resumeapplyr app. Never applies.
argument-hint: "<query> --board <domain> --campaign <campaign-id> [--max-jobs N]"
---

<!-- Adapted from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License. -->

# Job search

Search one board and rank what it finds by fit against the CV. This skill never applies: the user
reviews and approves the results in the app.

## Setup

1. Follow `../_shared/setup.md`.
2. Parse and strip the flags; the rest is the free-text query.
   - `--board <domain>` - required.
   - `--campaign <campaign-id>` - required; the app creates the campaign and passes it.
   - `--max-jobs <N>` - optional cap on results. Absent = keep going until the board runs dry.
3. `GET /api/campaigns/<campaign-id>`: read `config.resumeId` as `RESUME_ID` (absent → the primary).
4. `GET /api/job-boards` and take the entry whose `domain` is `<domain>`. None → `POST
   /api/campaigns/<campaign-id>/status {"status":"failed","reason":"<domain> isn't set up as a job
   board in the app"}` and stop.

## 1. Read the query

Pull out the role, keywords, location and other preferences ("remote", "no agencies", a salary
floor). Search with the query as written; the user isn't watching a chat to answer follow-ups.

## 2. Search the board

1. `browser_navigate` to the board's `searchUrl`.
2. Check the sign-in state per `../_shared/auth.md`.
3. Fill the search fields and submit.
4. `browser_snapshot` narrowed to the results list (`../_shared/browser-tips.md`) and read
   `{ title, company, location, url, postedAt }` per row. Scroll or page per **Pagination & infinite
   scroll** until `--max-jobs` is met or the results run dry.
5. Rank from the results row when it says enough. When a row is too thin to score fairly, delegate
   it to the `job-scorer` subagent with `mode:"score"`, `minMatchScore:0` (search keeps every result
   for the user to see) and `campaignId`; it opens the posting, scores it and saves the job itself.
   Leave those rows out of step 5.

## 3. Leave out jobs already applied to

Run the applied-check (`../_shared/campaign-flow.md`) per result. `.applied` → save it as
`pending`, then record `skipped` with `skipReason: "Already applied (<kind>)"`.

## 4. Score

Build the brief (`../_shared/job-brief.md`), write `{"brief": <brief>, "minScore": 0, "resumeId":
"<RESUME_ID>"}` to `$RESUMEAPPLYR_TEMP/fit.json` (drop `resumeId` when there is none), then:

```bash
resumeapplyr-api POST /api/score-fit --data @"$RESUMEAPPLYR_TEMP/fit.json"
```

`verdict: "trust"` → use `.score`. `"deliberate"` → adjust it yourself from `strongMatches`,
`partialMatches` and `gaps`. `eligibilityBlocked` → save the job, then skip it with the reason
`../_shared/eligibility.md` gives.

## 5. Save to the campaign

Save every result as a `pending` job (`../_shared/campaign-flow.md`, "Saving jobs") with its
`matchScore`, a one-line `matchReason` and the `brief`. Then:

```bash
resumeapplyr-api POST /api/campaigns/<campaign-id>/status --data '{"status":"completed"}'
```

## 6. Report

A compact ranked table, then one line telling the user to review and approve jobs in the app:

```
Saved <N> jobs for "<query>" on <board>. Review and approve them under Campaigns in resumeapplyr.

| # | Score | Title | Company | Location |
|---|-------|-------|---------|----------|
```

## Rules

The shared campaign rules (`../_shared/campaign-flow.md`) apply. On top of them:

1. One board per campaign: only `--board`.
2. Rate-limited or blocked by the site → note it, save what you have, finish.
3. De-duplicate within the board by URL.
