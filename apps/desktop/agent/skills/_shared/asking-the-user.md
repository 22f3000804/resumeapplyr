# Asking the user

The app shows your question in its window and as a system notification. The user answers there;
you wait for the answer through the API. Ask only when you can't continue without them: a sign-in,
a CAPTCHA, a verification code, a required form question your profile can't answer, or a salary
when no saved preference fits.

## 1. Ask

Write the question to a file and post it:

```json
{ "kind": "signin", "question": "Sign in to LinkedIn in the browser window, then press Done.",
  "context": "Needed to search linkedin.com", "url": "https://www.linkedin.com/login",
  "campaignId": "<id>", "jobKey": "<key>" }
```

```bash
resumeapplyr-api POST /api/questions --data @"$RESUMEAPPLYR_TEMP/<key>-question.json"
```

- `kind`: `signin`, `verification` (a 2FA or email code), `captcha`, `question`, `choice` (send
  `options`: short answers usable as-is), `salary`, or `review`.
- `question`: one sentence the user can act on from a glance.
- `answerKey`: for a reusable answer (`notice_period`, `relocation`, `start_date`), a short
  snake_case name. The app saves the answer so no later form asks again. Check `GET /api/answers`
  before asking anything.

## 2. Wait

```bash
resumeapplyr-api GET /api/questions/<id>/wait --query timeout=100
```

It returns when the user answers, or after `timeout` seconds. Read `.status`:

- `answered` → use `.answer` (for sign-in, CAPTCHA and verification it's usually "Done": re-check
  the page and continue).
- `pending` → call wait again. Give up after 6 calls (about ten minutes).
- `dismissed` or `expired` → the user declined. Treat the job as blocked (see the calling skill).

Never guess a code, a password, or an answer only the user knows.
