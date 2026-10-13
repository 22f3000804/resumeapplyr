// The window's side of the app: every RpcMethods entry, implemented on the services. Calls are
// accepted only from the app's own window, and errors come back as values, not exceptions.
import { rmSync, writeFileSync } from "node:fs";
import { type BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ZodError } from "zod";
import { HttpError, notFound } from "../core/errors";
import type { AgentSetup, RpcMethod, RpcMethods, RpcResult } from "../shared/rpc";
import { nodeStatus, PROVIDERS } from "./agent/providers";
import type { AgentRunner } from "./agent/runner";
import { applyApprovedTask, campaignTask, coverLetterTask, extractResumeTask, reviewResumeTask } from "./agent/tasks";
import type { SignInBrowser } from "./browser/signin";
import { renderResumeHtml } from "./pdf/templates";
import type { Services } from "./services";

type Handlers = {
  [M in RpcMethod]: (...args: Parameters<RpcMethods[M]>) => ReturnType<RpcMethods[M]> | Promise<Awaited<ReturnType<RpcMethods[M]>>>;
};

export interface IpcDeps {
  services: Services;
  runner: AgentRunner;
  signIn: SignInBrowser;
  window: () => BrowserWindow | null;
  version: string;
}

const safeName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "CV";

export function registerIpc(deps: IpcDeps): void {
  const { services: s, runner, signIn } = deps;
  let setup: AgentSetup | null = null;

  const checkSetup = async (): Promise<AgentSetup> => {
    const env = process.env;
    const [claude, codex, node] = await Promise.all([PROVIDERS.claude.status(env), PROVIDERS.codex.status(env), nodeStatus(env)]);
    setup = { provider: s.settings.get().provider, providers: [claude, codex], node, checkedAt: new Date().toISOString() };
    return setup;
  };

  const savePdf = async (defaultName: string, bytes: () => Promise<Buffer>): Promise<string | null> => {
    const win = deps.window();
    const options = { defaultPath: `${safeName(defaultName)}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, await bytes());
    return result.filePath;
  };

  const handlers: Handlers = {
    "app.info": () => ({ version: deps.version, dataDir: s.ctx.paths.root, platform: process.platform }),

    "profile.get": () => s.profile.get(),
    "profile.save": (profile) => s.profile.save(profile),
    "settings.get": () => s.settings.get(),
    "settings.update": (patch) => {
      const next = s.settings.update(patch);
      if (setup) setup = { ...setup, provider: next.provider };
      return next;
    },

    "boards.list": () => s.boards.list(),
    "boards.add": (input) => s.boards.add(input),
    "boards.remove": (domain) => s.boards.remove(domain),

    "resumes.list": () => s.resumes.list(),
    "resumes.get": (id) => s.resumes.get(id),
    "resumes.import": async () => {
      const win = deps.window();
      const options = { properties: ["openFile" as const], filters: [{ name: "PDF", extensions: ["pdf"] }] };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return null;
      return s.resumes.importFile(result.filePaths[0]);
    },
    "resumes.createBlank": () => s.resumes.createBlank(),
    "resumes.update": (id, patch) => s.resumes.update(id, patch),
    "resumes.setPrimary": (id) => s.resumes.setPrimary(id),
    "resumes.remove": (id) => s.resumes.remove(id),
    "resumes.variants": (id) => s.resumes.variants(id),
    "resumes.variant": (id) => s.resumes.variant(id),
    "resumes.acceptVariant": (id) => s.resumes.acceptVariant(id),
    "resumes.removeVariant": (id) => s.resumes.removeVariant(id),
    "resumes.previewHtml": (target) => {
      if ("content" in target) return renderResumeHtml(target.content, s.settings.get().paperSize);
      if ("variantId" in target) return s.resumes.variantHtml(target.variantId);
      return s.resumes.resumeHtml(target.resumeId);
    },
    "resumes.exportPdf": (target) => {
      if ("variantId" in target) {
        const variant = s.resumes.variant(target.variantId);
        return savePdf(variant.label, () => s.resumes.variantPdf(variant.id));
      }
      const resume = s.resumes.get(target.resumeId);
      return savePdf(resume.label, () => s.resumes.resumePdf(resume.id));
    },
    "resumes.openSource": async (id) => {
      const path = s.resumes.get(id).sourceAbsolutePath;
      if (!path) throw notFound("This CV has no uploaded PDF.");
      await shell.openPath(path);
    },

    "campaigns.list": () => s.campaigns.list({ limit: 100 }),
    "campaigns.get": (id) => s.campaigns.get(id),
    "campaigns.create": async (input, start) => {
      const campaign = s.campaigns.create({ ...input, createdBy: "user" });
      if (start) await runner.start(campaignTask(campaign));
      return s.campaigns.get(campaign.id);
    },
    "campaigns.jobs": (id, filter) => s.campaigns.jobs(id, { status: filter?.status, page: filter?.page ?? 1, limit: 100 }),
    "campaigns.approve": (id, keys) => s.campaigns.approveJobs(id, keys),
    "campaigns.skip": (id, keys) => s.campaigns.skipJobs(id, keys),
    "campaigns.setStatus": (id, status, reason) => {
      if (status === "paused" && runner.current()?.campaignId === id) runner.stop();
      return s.campaigns.setStatus(id, { status, reason }, "user");
    },
    "campaigns.remove": (id) => {
      if (runner.current()?.campaignId === id) runner.stop();
      s.campaigns.remove(id);
    },
    "campaigns.run": (id) => {
      const campaign = s.campaigns.get(id);
      if (campaign.status !== "in_progress") s.campaigns.setStatus(id, { status: "in_progress" }, "user");
      return runner.start(campaignTask(s.campaigns.get(id)));
    },
    "campaigns.applyApproved": (id) => {
      const campaign = s.campaigns.get(id);
      if (campaign.status !== "in_progress") s.campaigns.setStatus(id, { status: "in_progress" }, "user");
      return runner.start(applyApprovedTask(s.campaigns.get(id)));
    },

    "applications.list": (filter) => s.applications.list({ ...filter, limit: 100 }),
    "applications.get": (id) => s.applications.get(id),
    "applications.stats": () => {
      const stats = s.applications.stats();
      return { ...stats, dailyLimit: s.settings.get().dailyApplicationLimit, remainingToday: s.campaigns.remainingToday() };
    },
    "applications.update": (id, patch) => s.applications.update(id, patch),
    "applications.create": (input) => s.applications.createManual(input),
    "applications.remove": (id) => s.applications.remove(id),

    "questions.list": (status) => s.questions.list(status),
    "questions.answer": (id, answer, remember) => s.questions.answer(id, { answer, remember }, s.answers),
    "questions.dismiss": (id) => s.questions.dismiss(id),
    "questions.create": (input) => s.questions.create(input, null),

    "answers.list": () => s.answers.list(),
    "answers.upsert": (key, value) => s.answers.upsert({ key, value }),
    "answers.remove": (key) => s.answers.remove(key),

    "letters.list": () => s.letters.list(1, 100),
    "letters.get": (id) => s.letters.get(id),
    "letters.exportPdf": (id) => {
      const letter = s.letters.get(id);
      return savePdf(`Cover letter ${letter.company ?? ""}`, () => s.letters.pdf(letter.content));
    },

    "agent.setup": async (refresh) => (refresh || !setup ? checkSetup() : { ...setup, provider: s.settings.get().provider }),
    "agent.current": () => runner.current(),
    "agent.runs": () => s.runs.list(100),
    "agent.run": (id) => s.runs.get(id),
    "agent.events": (runId, afterId) => s.runs.events(runId, afterId),
    "agent.stop": () => runner.stop(),
    "agent.extractResume": (resumeId, force) => runner.start(extractResumeTask(s.resumes.get(resumeId), force)),
    "agent.reviewResume": (resumeId) => runner.start(reviewResumeTask(s.resumes.get(resumeId))),
    "agent.coverLetter": (input) => runner.start(coverLetterTask(input)),

    "browser.signIn": async (url) => {
      if (runner.current()) throw new HttpError("CONFLICT", "The agent is using the browser. Wait for it to finish, or stop it first.", 409);
      await signIn.open(url);
    },
    "browser.close": () => signIn.close(),
    "browser.status": () => ({ open: signIn.isOpen() }),
    "browser.resetProfile": async () => {
      if (runner.current()) throw new HttpError("CONFLICT", "Stop the agent before resetting the browser.", 409);
      await signIn.close();
      rmSync(s.ctx.paths.browserProfile, { recursive: true, force: true });
    },

    "shell.openExternal": async (url) => {
      if (!/^https?:\/\//i.test(url)) throw new HttpError("INVALID_REQUEST", "Only web links can be opened.", 400);
      await shell.openExternal(url);
    },
    "shell.openDataFolder": async () => {
      await shell.openPath(s.ctx.paths.root);
    },
  };

  ipcMain.handle("rpc", async (event, method: RpcMethod, ...args: unknown[]): Promise<RpcResult<unknown>> => {
    const win = deps.window();
    if (!win || event.sender !== win.webContents) {
      return { ok: false, error: { message: "Calls are only accepted from the app window." } };
    }
    const handler = handlers[method] as ((...a: unknown[]) => unknown) | undefined;
    if (!handler) return { ok: false, error: { message: `Unknown method ${String(method)}` } };
    try {
      return { ok: true, value: await handler(...args) };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: {
            message: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
            code: "INVALID_REQUEST",
            status: 400,
            details: error.issues,
          },
        };
      }
      if (error instanceof HttpError) {
        return { ok: false, error: { message: error.message, code: error.code, status: error.status, details: error.details } };
      }
      console.error(`[ipc] ${method}`, error);
      return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  });
}
