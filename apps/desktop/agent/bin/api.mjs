// @ts-check
// Calls the resumeapplyr app's local API for the agent. Adapted from JobPilot's jobpilot-api
// (https://github.com/suxrobgm/jobpilot, MIT License, Copyright (c) 2026 Sukhrob Ilyosbekov).
// Node's fetch does TLS and HTTP itself, so this also works inside the Codex Windows sandbox.
import { readFileSync, writeFileSync } from "node:fs";

const USAGE = `usage: resumeapplyr-api <METHOD> <path> [--query key=value]... [--data <json>|@<file>|-] [--out <file>]

  resumeapplyr-api GET /api/user
  resumeapplyr-api GET /api/applied/check --query url=https://... --query title=... --query company=...
  resumeapplyr-api POST /api/campaigns/<id>/jobs --data @"$RESUMEAPPLYR_TEMP/job.json"
  resumeapplyr-api GET /api/resumes/variants/<id>/pdf --out "$RESUMEAPPLYR_TEMP/resume.pdf"`;

// Question long-polls hold a request for up to ~110 seconds.
const REQUEST_TIMEOUT_MS = 120_000;

/** A usage or request failure reported on stderr without a stack trace. */
class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode 2 for bad usage, 1 for a failed request.
   */
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

/**
 * @param {string} message
 * @param {number} [exitCode]
 * @returns {never}
 */
function fail(message, exitCode = 2) {
  throw new CliError(message, exitCode);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const [method, path, ...rest] = argv;
  if (!method || !path || method === "--help" || method === "-h") fail(USAGE);

  /** @type {{ method: string, path: string, query: [string, string][], data: string | null, out: string | null }} */
  const request = { method: method.toUpperCase(), path, query: [], data: null, out: null };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1] ?? null;
    if (value === null) fail(`${flag} needs a value\n\n${USAGE}`);

    if (flag === "--query" || flag === "-q") {
      const separator = value.indexOf("=");
      if (separator < 1) fail(`--query takes key=value, got "${value}"`);
      request.query.push([value.slice(0, separator), value.slice(separator + 1)]);
    } else if (flag === "--data" || flag === "-d") {
      request.data = value;
    } else if (flag === "--out" || flag === "-o") {
      request.out = value;
    } else {
      fail(`unknown option ${flag}\n\n${USAGE}`);
    }
  }
  return request;
}

/** @param {string | null} data */
function readBody(data) {
  if (data === null) return null;
  let text = data;
  if (data === "-") text = readFileSync(0, "utf8");
  else if (data.startsWith("@")) text = readFileSync(data.slice(1), "utf8");
  // Windows PowerShell 5.1 writes UTF-8 files with a BOM, which JSON.parse rejects.
  text = text.replace(/^﻿/, "");
  try {
    JSON.parse(text);
  } catch (error) {
    fail(`request body is not valid JSON: ${/** @type {Error} */ (error).message}`);
  }
  return text;
}

/**
 * @param {string} base
 * @param {string} rawPath
 * @param {[string, string][]} query
 */
function buildUrl(base, rawPath, query) {
  // Git Bash rewrites a leading-slash argument into a Windows path, so "api/user" is accepted too.
  const path = rawPath.startsWith("api/") ? `/${rawPath}` : rawPath;
  // Only API-relative paths, so the token can never reach another origin.
  if (!path.startsWith("/") || path.startsWith("//")) fail(`path must be API-relative, like /api/user - got "${rawPath}"`);
  const url = new URL(base.replace(/\/+$/, "") + path);
  if (url.origin !== new URL(base).origin) fail(`path "${path}" leaves ${base}`);
  for (const [key, value] of query) url.searchParams.append(key, value);
  return url;
}

async function main() {
  const request = parseArgs(process.argv.slice(2));
  const base = process.env.RESUMEAPPLYR_API;
  if (!base) fail("RESUMEAPPLYR_API is unset - this session was not started by the resumeapplyr app");

  const url = buildUrl(base, request.path, request.query);
  const body = readBody(request.data);
  /** @type {Record<string, string>} */
  const headers = { accept: "application/json" };
  if (process.env.RESUMEAPPLYR_API_TOKEN) headers.authorization = `Bearer ${process.env.RESUMEAPPLYR_API_TOKEN}`;
  if (process.env.RESUMEAPPLYR_RUN_ID) headers["x-resumeapplyr-run"] = process.env.RESUMEAPPLYR_RUN_ID;
  if (body !== null) headers["content-type"] = "application/json";

  /** @type {Response} */
  let response;
  try {
    response = await fetch(url, { method: request.method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const failure = /** @type {Error & { cause?: Error }} */ (error);
    fail(`${request.method} ${request.path} failed: ${failure.cause?.message ?? failure.message}. Is the resumeapplyr app still open?`, 1);
  }

  if (!response.ok) {
    const detail = await response.text();
    fail(`HTTP ${response.status} ${request.method} ${request.path}${detail ? `\n${detail}` : ""}`, 1);
  }

  if (request.out !== null) {
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(request.out, bytes);
    process.stderr.write(`saved ${bytes.length} bytes to ${request.out}\n`);
    return;
  }
  process.stdout.write(await response.text());
}

// process.exit() with fetch handles still open aborts Node on Windows, so only set the exit code.
try {
  await main();
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode;
}
