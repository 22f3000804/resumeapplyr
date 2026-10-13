# resumeapplyr — landing page

Implementation of **`Volley Mockups.dc.html`** from the Claude Design project
[8d7a4516](https://claude.ai/design/p/8d7a4516-c502-462a-a5fb-926dea32a5e3?file=Volley+Mockups.dc.html)
(the mockups predate the rename to resumeapplyr).

Static HTML and CSS with no build step, which is how the Modernist design system it consumes is
meant to be used, plus one Cloudflare Pages Function that stores signups in D1.

## Files

| Path | What it is |
| --- | --- |
| `public/index.html` | The full landing page — artboard **1a**, with hero direction **1b** in place |
| `public/hero-ticker.html` | Hero direction **1c** — "the machine on show", with a sample-data ticker |
| `public/hero-poster.html` | Hero direction **1d** — the red poster |
| `public/privacy.html` | What signup collects, where it's kept, how to have it deleted |
| `public/404.html` | Served for unknown paths (its presence also turns off Pages' SPA fallback) |
| `public/styles/modernist.css` | The Modernist design system, vendored verbatim. Don't hand-edit; re-sync it from the design project |
| `public/styles/site.css` | Page styles — the mockup's inline styles lifted into classes, plus breakpoints |
| `public/scripts/site.js` | CTA label, signup handling, ticker rendering |
| `public/_headers` | Security headers (CSP, frame and referrer policy) for every static file |
| `public/favicon.svg`, `public/og.png` | Tab icon and link-preview image |
| `functions/api/signup.js` | `POST /api/signup` → one row in the D1 `signups` table |
| `migrations/0001_create_signups.sql` | The `signups` table |
| `wrangler.jsonc` | Pages project config. **Only `public/` is uploaded** |
| `tests/` | Function unit tests, a local preview server and browser checks |

## Run it locally

```sh
npm install          # Playwright + axe-core, for the browser checks only
npm run serve        # http://localhost:8788 — pages plus /api/signup on an in-memory database
npm test             # signup function tests (node:test, no dependencies)
npm run test:e2e     # browser checks: copy, signup flow, overflow, accessibility
```

`npm run serve -- --no-db` shows what visitors see before D1 is connected.

## Signup

The forms `POST { email, source, website }` to `/api/signup`. `website` is a honeypot: people
never see it, bots fill it in, and the function answers "ok" without storing anything. A repeat
address also answers "ok", so the endpoint never reveals who is already on the list.

Until the D1 binding in `wrangler.jsonc` is filled in, the function answers `503` and the form says
"Signups aren't switched on yet". Setting it up takes two commands — see
[docs/deploy.md](../../docs/deploy.md).

Read the list with:

```sh
npx wrangler d1 execute resumeapplyr-signups --remote --command "SELECT * FROM signups ORDER BY created_at DESC"
```

## Config

What's left of the canvas's `DCLogic renderVals()` props lives in `CONFIG` at the top of
`public/scripts/site.js`:

| Key | Notes |
| --- | --- |
| `ctaLabel` | Fills every `[data-cta-label]` |
| `signupEndpoint` | `/api/signup`, the same-origin Pages Function |
| `ticker` | Sample rows for the ticker hero, labelled as samples on the page |

The canvas's `signupCount`, `showSocialProof` and `scrapedCount` props are gone: they showed
invented numbers ("1,284 CVs written", a live scrape counter). The stats band now states four
things that are true of the product. Bring numbers back only when they come from real data.

## Choosing a different hero

The alternate hero pages are previews of directions 1c and 1d, not full pages. To adopt one: copy
its `<section>` (and its `<nav>`, for the poster's inverted bar) into `index.html` in place of
`<section class="hero">`, then delete the `.variants` preview bar and the two preview files.

## Where this departs from the artboard

- **Breakpoints.** The canvas is a fixed 1400px artboard, so responsive behaviour was decided here:
  the 7fr/5fr splits collapse at 1080px, the stats band goes 4 → 2 → 1 columns, and the nav links
  fold away below 760px leaving the brand and the primary action.
- **`.btn-inverse`.** The mockup put `.btn-ghost` on the red banner with a visible border.
  `.btn-ghost` carries a 4px inline padding intended for a borderless button, which looks pinched
  once the border shows, so the inverted button keeps the standard `.btn` padding.
- **Nav button colour.** Modernist's `.nav a` rules out-rank `.btn-primary`, which gave the nav
  button ink text and made its label vanish on hover. `site.css` restores the light label.
- **Sample CV.** The design's grey placeholder is now an HTML page for an invented candidate,
  cropped at the design's 951:665 ratio and captioned as fictional.
- **Semantics.** Steps are an `<ol>`, the checklist and tag rows are `<ul>`s, and each signup field
  has a visually-hidden `<label>` and a `role="status"` line for its result.

## Known issue

Light text on the vermilion accent (`#f3f2f2` on `#ec3013`) is 3.75:1. WCAG AA asks for 4.5:1
below 24px (18.66px bold), so the primary buttons and the small text on the red banner fall short.
It comes from the Modernist tokens; fix it in the design system (for example, a darker button
fill) and re-sync, rather than patching `modernist.css` here.
