# resumeapplyr: notes for working in this repo

## The product

resumeapplyr finds jobs on boards the user picks, scores each posting against their CV, and applies
with a tailored copy, only where the user allows. The name is always written **resumeapplyr**, in
lowercase. The product was once called "Volley"; that name must not appear anywhere users see it.

## Layout

- `apps/site`: landing page. Static HTML/CSS with no build step, on Cloudflare Pages, plus
  `functions/api/signup.js` (D1). Only `public/` is deployed.
- `apps/desktop`: Electron app (electron-vite, React, TypeScript, `node:sqlite`). Its parts:
  - `src/main/services`: data and every rule (approval, limits, duplicates).
  - `src/main/api`: the local API the agent calls.
  - `src/main/agent`: runs Claude Code or Codex headless.
  - `src/core`: pure logic.
  - `src/renderer`: the window.
  - `agent/`: the skills plugin the agent runs.
- `docs/`: `desktop.md` (architecture and releases), `deploy.md`, `blueprint.md`, `ingestion.md`.

## Commands

```sh
# site
cd apps/site && npm test && npm run test:e2e

# desktop
cd apps/desktop && npm run typecheck && npm test
cd apps/desktop && npm run test:e2e        # on Linux without a display: xvfb-run -a npm run test:e2e
```

Run the relevant suite before committing. The desktop end-to-end test uses a fake `claude`
(`tests/fixtures/fake-agent*.mjs`). Update the fake if you change how the app talks to the agent.

## Rules to keep

- **The app enforces, the agent asks.** Approval, daily and campaign limits, pauses and duplicate
  checks live in `src/main/services/campaigns.ts` and run whenever a job moves to `applying`. Never
  move a rule into a skill alone.
- **Nothing invented.** Tailoring may reword and reorder a CV, never add facts. The guards are in
  `src/core/tailoring`. The website shows no made-up numbers, testimonials or logos; its stats band
  states product facts.
- **Out of scope on purpose.** No CAPTCHA solving or solving services, no automatic account
  creation or password resets, no bot-detection evasion. The agent asks the user through the
  questions API instead.
- **Local-first.** The desktop app sends nothing to a resumeapplyr server. Its API listens on
  127.0.0.1 with a per-launch token and a Host check.

## Design

Both apps use the Modernist design system: Archivo 400/600/800, zero radius, 2px rules, vermilion
`#ec3013` accent. Small accent text uses `--color-accent-700` because the accent itself is only
about 3.7:1 on the background. `modernist.css` is vendored. It's verbatim in the site; the desktop
copy only drops the Google Fonts import, since the app bundles Archivo. Don't hand-edit either copy.
Put app-specific styles in `site.css` or `src/renderer/src/styles/app.css`.

Copy is plain and in sentence case, and buttons say what they do ("Save profile", "Apply to
approved").

## Ported code

Code adapted from JobPilot (MIT) keeps the attribution header at the top of the file. If you port
more, keep the header and update `THIRD_PARTY_NOTICES.md`.
