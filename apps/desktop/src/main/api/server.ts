// The localhost API the agent calls through `resumeapplyr-api`. Paths and payloads follow
// JobPilot's hosted API, so its skills port over with few changes; here it runs inside the app and
// every rule is enforced by the services behind it.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ZodError } from "zod";
import { HttpError } from "../../core/errors";
import type { Services } from "../services";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** The agent run making the call, from the X-Resumeapplyr-Run header the CLI sends. */
  runId: string | null;
}

interface Binary {
  binary: Buffer;
  contentType: string;
}

type Handler = (req: ApiRequest) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export interface ApiServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

export interface ApiOptions {
  token?: string;
  port?: number;
  version: string;
}

class Router {
  readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      })}$`,
    );
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { handler: route.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}

const num = (value: string | null): number | undefined => {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const pdf = (buffer: Buffer): Binary => ({ binary: buffer, contentType: "application/pdf" });

export function buildRouter(s: Services, version: string): Router {
  const r = new Router();
  const userPayload = () => {
    const profile = s.profile.get();
    const settings = s.settings.get();
    const missing = s.profile.missing();
    const primaryResumeId = s.resumes.primaryId();
    const primary = primaryResumeId ? s.resumes.get(primaryResumeId) : null;
    const appliedToday = s.applications.appliedToday();
    return {
      user: { ...profile, primaryResumeId },
      profileComplete: missing.length === 0,
      missing,
      autoApply: {
        minMatchScore: settings.minMatchScore,
        maxApplicationsPerCampaign: settings.maxApplicationsPerCampaign,
        defaultStartDate: settings.defaultStartDate,
      },
      settings: {
        approvalMode: settings.approvalMode,
        autoApplyThreshold: settings.autoApplyThreshold,
        dailyApplicationLimit: settings.dailyApplicationLimit,
        minMatchScore: settings.minMatchScore,
      },
      limits: {
        dailyApplicationLimit: settings.dailyApplicationLimit,
        appliedToday,
        remainingToday: s.campaigns.remainingToday(),
      },
      primaryResumeId,
      primaryResumeSourceAbsolutePath: primary?.sourceAbsolutePath ?? null,
      resumes: s.resumes.list(),
    };
  };

  r.add("GET", "/api/health", () => ({ ok: true, app: "resumeapplyr", version }));
  r.add("GET", "/api/user", userPayload);
  r.add("GET", "/api/limits", () => {
    const settings = s.settings.get();
    return {
      dailyApplicationLimit: settings.dailyApplicationLimit,
      appliedToday: s.applications.appliedToday(),
      remainingToday: s.campaigns.remainingToday(),
      approvalMode: settings.approvalMode,
      autoApplyThreshold: settings.autoApplyThreshold,
    };
  });

  // Variant routes first: "variants" would otherwise match /api/resumes/:id.
  r.add("GET", "/api/resumes/variants/:id/pdf", async ({ params }) => pdf(await s.resumes.variantPdf(params.id)));
  r.add("GET", "/api/resumes/variants/:id", ({ params }) => s.resumes.variant(params.id));
  r.add("GET", "/api/resumes", () => s.resumes.list());
  r.add("GET", "/api/resumes/:id/pdf", async ({ params }) => pdf(await s.resumes.resumePdf(params.id)));
  r.add("GET", "/api/resumes/:id/variants", ({ params }) => s.resumes.variants(params.id));
  r.add("POST", "/api/resumes/:id/variants", ({ params, body }) => s.resumes.createVariant(params.id, body));
  r.add("POST", "/api/resumes/:id/tailor", ({ params, body }) => s.resumes.tailor(params.id, body));
  r.add("GET", "/api/resumes/:id", ({ params }) => s.resumes.get(params.id));
  r.add("PUT", "/api/resumes/:id", ({ params, body }) => s.resumes.update(params.id, body));

  r.add("GET", "/api/applied/check", ({ query }) =>
    s.applications.appliedCheck({
      url: query.get("url") ?? undefined,
      title: query.get("title") ?? undefined,
      company: query.get("company") ?? undefined,
    }),
  );
  r.add("GET", "/api/applied", ({ query }) =>
    s.applications.list({
      status: query.get("status") ?? undefined,
      search: query.get("search") ?? undefined,
      page: num(query.get("page")),
      limit: num(query.get("limit")),
    }),
  );
  r.add("POST", "/api/score-fit", ({ body }) => s.scoring.score(body));
  r.add("GET", "/api/job-boards", () => s.boards.list());

  r.add("GET", "/api/campaigns", ({ query }) =>
    s.campaigns.list({
      status: query.get("status") ?? undefined,
      source: query.get("source") ?? undefined,
      jobStatus: query.get("jobStatus") ?? undefined,
      page: num(query.get("page")),
      limit: num(query.get("limit")),
    }),
  );
  r.add("POST", "/api/campaigns", ({ body }) => s.campaigns.create({ ...(body as object), createdBy: "agent" }));
  r.add("GET", "/api/campaigns/:id", ({ params }) => s.campaigns.get(params.id));
  r.add("POST", "/api/campaigns/:id/status", ({ params, body }) => s.campaigns.setStatus(params.id, body, "agent"));
  r.add("GET", "/api/campaigns/:id/jobs", ({ params, query }) =>
    s.campaigns.jobs(params.id, {
      status: query.get("status") ?? undefined,
      page: num(query.get("page")),
      limit: num(query.get("limit")),
    }),
  );
  r.add("POST", "/api/campaigns/:id/jobs", ({ params, body }) => s.campaigns.addJob(params.id, body));
  r.add("PATCH", "/api/campaigns/:id/jobs/:key", ({ params, body }) => s.campaigns.patchJob(params.id, params.key, body));
  r.add("POST", "/api/campaigns/:id/jobs/:key/result", ({ params, body }) =>
    s.campaigns.writeResult(params.id, params.key, body),
  );

  r.add("POST", "/api/cover-letters/pdf", async ({ body }) => {
    const text = typeof (body as { text?: unknown })?.text === "string" ? (body as { text: string }).text : "";
    if (!text.trim()) throw new HttpError("INVALID_REQUEST", "Send {\"text\": \"<letter>\"}.", 400);
    return pdf(await s.letters.pdf(text));
  });
  r.add("GET", "/api/cover-letters", ({ query }) => s.letters.list(num(query.get("page")), num(query.get("limit"))));
  r.add("GET", "/api/cover-letters/:id", ({ params }) => s.letters.get(params.id));
  r.add("POST", "/api/cover-letters", ({ body }) => s.letters.create(body));

  r.add("GET", "/api/answers", () => s.answers.list().map(({ key, value }) => ({ key, value })));
  r.add("POST", "/api/questions", ({ body, runId }) => s.questions.create(body, runId));
  r.add("GET", "/api/questions/:id/wait", ({ params, query }) =>
    s.questions.wait(params.id, num(query.get("timeout")) ?? 60),
  );
  r.add("GET", "/api/questions/:id", ({ params }) => s.questions.get(params.id));
  return r;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  if (payload && typeof payload === "object" && "binary" in payload && Buffer.isBuffer((payload as Binary).binary)) {
    const { binary, contentType } = payload as Binary;
    res.writeHead(status, { "content-type": contentType, "content-length": binary.length, "cache-control": "no-store" });
    res.end(binary);
    return;
  }
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError("INVALID_REQUEST", "Request body is too large.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
      if (!raw.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError("INVALID_REQUEST", "The request body is not valid JSON.", 400));
      }
    });
    req.on("error", reject);
  });
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startApiServer(services: Services, options: ApiOptions): Promise<ApiServer> {
  const token = options.token ?? randomBytes(32).toString("base64url");
  const router = buildRouter(services, options.version);
  let port = 0;

  const server = createServer(async (req, res) => {
    try {
      // Refuse anything addressed to another host name: blocks DNS-rebinding from web pages.
      const host = (req.headers.host ?? "").toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        throw new HttpError("FORBIDDEN", "Unexpected host.", 403);
      }
      if (!tokenMatches(req.headers.authorization, token)) {
        throw new HttpError("UNAUTHORIZED", "Missing or wrong token. Call the API through resumeapplyr-api.", 401);
      }
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const method = (req.method ?? "GET").toUpperCase();
      const found = router.match(method, url.pathname);
      if (found === null) throw new HttpError("NOT_FOUND", `No such endpoint: ${method} ${url.pathname}`, 404);
      if (found === "method") throw new HttpError("INVALID_REQUEST", `${method} is not supported on ${url.pathname}`, 405);
      const body = method === "GET" || method === "DELETE" ? undefined : await readBody(req);
      const runHeader = req.headers["x-resumeapplyr-run"];
      const result = await found.handler({
        method,
        path: url.pathname,
        params: found.params,
        query: url.searchParams,
        body,
        runId: typeof runHeader === "string" && runHeader ? runHeader : null,
      });
      send(res, method === "POST" ? 201 : 200, result);
    } catch (error) {
      if (error instanceof ZodError) {
        send(res, 400, {
          code: "INVALID_REQUEST",
          message: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
          details: error.issues,
        });
      } else if (error instanceof HttpError) {
        send(res, error.status, { code: error.code, message: error.message, details: error.details });
      } else {
        console.error("[api]", error);
        send(res, 500, { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unexpected error" });
      }
    }
  });
  // Long-polls (questions/:id/wait) hold a request for up to ~110s.
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        token,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
