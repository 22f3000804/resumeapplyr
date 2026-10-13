# Signing in

The browser you drive keeps its own profile on this computer, so once the user has signed in to a
site, they stay signed in. The app never stores job-board passwords, and you never type one.

## Check first

Before searching or applying on a site, take a `browser_snapshot` narrowed to the header. A Sign in
/ Log in control or a visible password field means signed out; an account menu or avatar means
signed in - carry on.

## Signed out

1. Search without signing in when the site allows it.
2. Otherwise ask the user to sign in (`./asking-the-user.md`, `kind: "signin"`): "Sign in to
   <site> in the browser window, then press Done." Navigate to the site's sign-in page first so it's
   in front of them.
3. When they answer, re-check the header. Still signed out → record the job as failed with
   `failReason: "Not signed in to <site>"` (or, during a search, stop with that as the error).

## Creating an account

Some application portals (Workday and many company ATSs) need an account per employer. Never create
one on your own. Ask the user (`kind: "signin"`): "<Company>'s careers site needs an account. Create
one or sign in in the browser window, then press Done."

## Codes and CAPTCHAs

- **Verification code / 2FA**: ask (`kind: "verification"`). If the user types the code as the
  answer, enter it; if they answer "Done", they entered it themselves.
- **CAPTCHA**: never try to solve or bypass one, and never use a solving service. Ask the user to
  solve it in the browser (`kind: "captcha"`), then re-check the page. No answer → skip the job with
  `skipReason: "CAPTCHA - apply manually"`.

## Single sign-on

If a site offers "Sign in with Google/LinkedIn", don't use it on your own: ask the user to sign in.
