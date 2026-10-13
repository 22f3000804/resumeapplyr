# resumeapplyr desktop

The Electron app that runs the job-search agent on the user's own computer. The architecture, the
rules it enforces, development and releases are all in [docs/desktop.md](../../docs/desktop.md).

```sh
npm install
npm run dev            # the app, with a hot-reloading window
npm run typecheck
npm test               # unit, API and runner tests
npm run test:e2e       # the whole loop against a fake agent (Linux without a display: xvfb-run -a …)
npm run dist           # installers for this OS, into release/<version>/
```

| Path | What it is |
| --- | --- |
| `src/main` | Main process: services and rules, the local API, the agent runner, PDF rendering, IPC |
| `src/preload` | The window's bridge to the main process |
| `src/renderer` | The window (React) |
| `src/shared` | Types and the IPC contract shared by both sides |
| `src/core` | Pure logic: scoring, duplicates, tailoring guards, schemas |
| `agent/` | The skills plugin Claude Code or Codex runs, and the `resumeapplyr-api` command |
| `tests/` | Vitest suites, the end-to-end runner and the fake agent |
| `build/` | App icon |
