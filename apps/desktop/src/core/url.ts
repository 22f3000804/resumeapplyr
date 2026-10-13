/**
 * Strips what varies between two links to one page: fragment, host case, `www.`, tracking params,
 * param order. Null for anything unparseable or not http(s). Scheme and trailing slash are left to
 * the caller.
 *
 * Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License.
 */
export function parseCanonicalUrl(raw: string, isTracking: (name: string) => boolean): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  for (const name of [...url.searchParams.keys()]) {
    if (isTracking(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
  }
  url.searchParams.sort();
  return url;
}

/** Trims a user-entered link and adds `https://` when it has no scheme. Blank stays blank. */
export function normalizeLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The registrable-ish host of a URL, lower-cased without `www.`; null when it doesn't parse. */
export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
