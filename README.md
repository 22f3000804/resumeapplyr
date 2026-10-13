# resumeapplyr

resumeapplyr applies for jobs from your own computer. It searches the job boards you pick and scores
every posting against your CV, giving the reason for each score. It then applies with a copy of your
CV tailored to that one role, but only to the jobs you approve, or above a score you set. Nothing on
your CV gets made up along the way.

## What's in this repository

| Path | What it is |
| --- | --- |
| [`apps/site`](apps/site) | The landing page at [resumeapplyr.pages.dev](https://resumeapplyr.pages.dev): static HTML and CSS on Cloudflare Pages, plus one Pages Function that stores signups in D1 |
| [`apps/desktop`](apps/desktop) | The desktop app (Electron). It runs the agent on the user's own Claude Code or Codex subscription and stores everything locally |
| [`docs/desktop.md`](docs/desktop.md) | How the desktop app works, the rules it enforces, developing and releasing it |
| [`docs/deploy.md`](docs/deploy.md) | Deploying the site, and the one-time signup database setup |
| [`docs/blueprint.md`](docs/blueprint.md) | The product problem statement |
| [`docs/ingestion.md`](docs/ingestion.md) | A design for server-side job ingestion (not built yet) |
| [`.github/workflows`](.github/workflows) | CI, the site deploy and desktop releases |

## Quick start

The website (Node 22):

```sh
cd apps/site
npm install
npm run serve        # http://localhost:8788, with signups on an in-memory database
npm test && npm run test:e2e
```

The desktop app (Node 22; you need Claude Code or Codex installed and signed in, and Chrome or Edge):

```sh
cd apps/desktop
npm install
npm run dev
npm run typecheck && npm test && npm run test:e2e   # Linux: xvfb-run -a npm run test:e2e
```

## Where things stand

- **Website:** live. The signup form waits on a one-time D1 setup (two commands, in
  [docs/deploy.md](docs/deploy.md)). Until then it tells visitors signups aren't open yet.
- **Desktop app:** version 0.1.0. It runs end to end against a fake agent in tests, but hasn't yet
  been run against a real Claude Code or Codex session, and its installers have only been built
  on Linux. See [Known gaps](docs/desktop.md#known-gaps).

## Credits

The desktop agent builds on [JobPilot](https://github.com/suxrobgm/jobpilot) by Sukhrob Ilyosbekov
and the [humanizer](https://github.com/blader/humanizer) skill by Siqi Chen, both MIT licensed. The
typeface is Archivo, under the SIL Open Font License. Full notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
