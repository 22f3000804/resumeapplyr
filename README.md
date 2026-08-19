# Volley — landing page

Implementation of **`Volley Mockups.dc.html`** from the Claude Design project
[8d7a4516](https://claude.ai/design/p/8d7a4516-c502-462a-a5fb-926dea32a5e3?file=Volley+Mockups.dc.html).

Static HTML and CSS, no build step and no dependencies — which is how the
Modernist design system it consumes is meant to be used.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The full landing page — artboard **1a**, with hero direction **1b** in place |
| `hero-ticker.html` | Hero direction **1c** — "the machine on show", with the live scrape ticker |
| `hero-poster.html` | Hero direction **1d** — the red poster |
| `styles/modernist.css` | The Modernist design system, vendored verbatim from `_ds/modernist-…/styles.css`. Don't hand-edit; re-sync it from the design project |
| `styles/site.css` | Page styles — the mockup's inline styles lifted into classes, plus the breakpoints |
| `scripts/site.js` | Config, signup handling, ticker rendering |

Open `index.html` directly, or serve the folder:

```sh
python -m http.server 8000
```

## Config

The canvas drove its copy from a `DCLogic renderVals()` block with four props.
Those became `CONFIG` at the top of `scripts/site.js`:

| Key | Was | Notes |
| --- | --- | --- |
| `ctaLabel` | prop `ctaLabel` | Fills every `[data-cta-label]` |
| `signupCount` | prop `signupCount` | Fills `[data-signups]` and the social-proof line |
| `showSocialProof` | prop `showSocialProof` | Switches the line under the signup field |
| `signupEndpoint` | — | **Currently `null`** (see below) |
| `scrapedCount`, `ticker` | `renderVals()` locals | Feed the ticker hero |

The `showStats` prop gated the four-number band. There is no runtime toggle for
it in a static page — delete the `<section class="stats">` block and the rule
under it if you don't want that band.

Every value also sits inline in the HTML, so the page reads correctly with
JavaScript off; the script only keeps the numbers in one place.

## Not wired up

Two things in the design have no real source behind them yet, and both are
marked in the code rather than faked:

- **Signup has no backend.** `CONFIG.signupEndpoint` is `null`, so submitting
  validates the address, shows the success state and stores nothing. Point it at
  an endpoint that accepts `POST { "email": "…" }` and it starts working — no
  other change needed.
- **The sample CV is a placeholder.** The mockup carried the note "send me a
  real one and I'll set it in". `index.html` has the slot at the design's 951:665
  ratio with the `.grayscale` wrapper and a commented-out `<img>` ready for it.

The ticker's postings are also sample data — the design's own caption says as
much ("scores are against a sample profile").

## Choosing a different hero

The alternate hero pages are previews of directions 1c and 1d, not full pages.
To adopt one: copy its `<section>` (and its `<nav>`, for the poster's inverted
bar) into `index.html` in place of `<section class="hero">`, then delete the
`.variants` preview bar and the two preview files.

## Where this departs from the artboard

- **Breakpoints.** The canvas is a fixed 1400px artboard, so responsive
  behaviour had to be decided here: the 7fr/5fr splits collapse at 1080px, the
  stats band goes 4 → 2 → 1 columns, and the nav links fold away below 760px
  leaving the brand and the primary action.
- **`.btn-inverse`.** The mockup put `.btn-ghost` on the red banner with a
  visible border. `.btn-ghost` carries a 4px inline padding intended for a
  borderless button, which looks pinched once the border shows, so the inverted
  button keeps the standard `.btn` padding.
- **Semantics.** Steps are an `<ol>`, the checklist and tag rows are `<ul>`s,
  and each signup field has a visually-hidden `<label>` and a `role="status"`
  line for its result.
