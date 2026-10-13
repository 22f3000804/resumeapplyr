import { join } from "node:path";
import { app, BrowserWindow, Menu, Notification, shell } from "electron";
import { AgentRunner } from "./agent/runner";
import { startApiServer } from "./api/server";
import { SignInBrowser } from "./browser/signin";
import { Db } from "./db/database";
import { registerIpc } from "./ipc";
import { ensureDirs, pruneRunFolders, resolvePaths } from "./paths";
import { createPdfRenderer } from "./pdf/render";
import { createServices } from "./services";
import { EventBus } from "./services/context";
import type { Question } from "./services/misc";

const here = import.meta.dirname;
let mainWindow: BrowserWindow | null = null;

// Tests point the app at a throwaway data folder.
if (process.env.RESUMEAPPLYR_USER_DATA) app.setPath("userData", process.env.RESUMEAPPLYR_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "resumeapplyr",
    backgroundColor: "#f3f2f2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Links open in the user's own browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(here, "../renderer/index.html"));
  }
  return win;
}

async function start(): Promise<void> {
  const agentDir = app.isPackaged ? join(process.resourcesPath, "agent") : join(app.getAppPath(), "agent");
  const paths = resolvePaths(app.getPath("userData"), agentDir);
  ensureDirs(paths);
  pruneRunFolders(paths);

  const events = new EventBus();
  const db = new Db(paths.db);
  const services = createServices({ db, events, paths, pdf: createPdfRenderer(), now: () => new Date() });
  // Anything left mid-apply when the app last closed goes back to where a run can pick it up.
  services.campaigns.releaseApplying(null, "The app closed while this application was in progress.");

  const api = await startApiServer(services, { version: app.getVersion() });
  const signIn = new SignInBrowser(paths.browserProfile, () => services.settings.get().browserChannel);
  const runner = new AgentRunner({ services, paths, api, beforeStart: () => signIn.close() });

  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }])
      : null,
  );
  mainWindow = createWindow();
  registerIpc({ services, runner, signIn, window: () => mainWindow, version: app.getVersion() });

  const send = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  events.on("changed", (topics) => send("changed", topics));
  events.on("run-event", (event) => send("run-event", event));
  events.on("question", (question: Question) => {
    send("question", question);
    if (Notification.isSupported() && !mainWindow?.isFocused()) {
      const note = new Notification({ title: "resumeapplyr needs you", body: question.question });
      note.on("click", () => mainWindow?.show());
      note.show();
    }
  });
  runner.on("changed", (current) => send("runner", current));
  runner.on("finished", (run) => {
    if (Notification.isSupported() && !mainWindow?.isFocused()) {
      const body = run.status === "succeeded" ? (run.summary ?? "Done.").slice(0, 180) : (run.error ?? run.status).slice(0, 180);
      new Notification({ title: run.status === "succeeded" ? `Finished: ${run.title}` : `Stopped: ${run.title}`, body }).show();
    }
  });

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    runner.stop();
    void Promise.allSettled([signIn.close(), api.close()]).finally(() => {
      db.close();
      app.quit();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}
