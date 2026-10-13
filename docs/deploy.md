# Deploying

## The website (Cloudflare Pages)

The site is the existing Pages project **`resumeapplyr`** (https://resumeapplyr.pages.dev). It was
created as a *Direct Upload* project, so it deploys from your machine or from CI with Wrangler; it
can't be switched to Pages' Git integration later.

Everything happens in `apps/site`. `wrangler.jsonc` sets `pages_build_output_dir` to `public`, so
**only `public/` is uploaded** — the old setup uploaded the whole working folder, which is how
`CLOUDFLARE_DEPLOY.md` and `wrangler.jsonc` ended up publicly downloadable.

### One-time: the signups database

```sh
cd apps/site
npx wrangler@4 login                                    # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npx wrangler@4 d1 create resumeapplyr-signups           # prints a database_id
```

Paste the `database_id` into the commented `d1_databases` block in `apps/site/wrangler.jsonc` and
uncomment it, then create the table:

```sh
npx wrangler@4 d1 migrations apply resumeapplyr-signups --remote
```

Until this is done the site still deploys and works; the signup form just says signups aren't
switched on yet (`/api/signup` answers `503`).

### Every deploy

```sh
cd apps/site
npm test                                                # signup function tests
npx wrangler@4 pages deploy --branch main               # reads wrangler.jsonc
```

`--branch main` publishes to production. Any other branch name gives a preview URL.

### From GitHub instead (optional)

`.github/workflows/deploy-site.yml` runs the same deploy on every push to `main` that touches
`apps/site/`. It needs two repository secrets, which only the repo owner can add:

- `CLOUDFLARE_API_TOKEN` — a token with *Cloudflare Pages: Edit* (and *D1: Edit* if migrations run in CI)
- `CLOUDFLARE_ACCOUNT_ID`

Without them the workflow skips the deploy step and says so.

### Reading signups

```sh
npx wrangler@4 d1 execute resumeapplyr-signups --remote \
  --command "SELECT email, source, created_at FROM signups ORDER BY created_at DESC"
```

## The desktop app

See [desktop.md](desktop.md#releases) for building installers.
