// End-to-end check of the built app: launches Electron on a throwaway data folder with a fake
// `claude` on PATH, then walks the whole loop a user would — profile, CV, campaign, the agent's
// question, approving, applying — and saves a screenshot of each screen.
//
//   npm run test:e2e                      (on Linux CI: xvfb-run -a npm run test:e2e)
//   E2E_SCREENSHOTS=/some/dir npm run test:e2e
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..");
const work = mkdtempSync(join(tmpdir(), "resumeapplyr-e2e-"));
const userData = join(work, "user-data");
const shots = process.env.E2E_SCREENSHOTS ?? join(work, "screenshots");
mkdirSync(shots, { recursive: true });

// A fake `claude` that answers the version probe and plays the search and apply skills.
const bin = join(work, "bin");
mkdirSync(bin);
const fake = join(appDir, "tests", "fixtures", "fake-agent.mjs");
if (process.platform === "win32") {
  writeFileSync(join(bin, "claude.cmd"), `@echo off\r\nset FAKE_AGENT_PROVIDER=claude\r\nset FAKE_AGENT_MODE=e2e\r\nnode "${fake}" %*\r\n`);
} else {
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nFAKE_AGENT_PROVIDER=claude FAKE_AGENT_MODE=e2e exec node "${fake}" "$@"\n`);
  chmodSync(join(bin, "claude"), 0o755);
}

// A one-page PDF to upload as a CV.
const samplePdf = join(work, "Asha Verma CV.pdf");
writeFileSync(
  samplePdf,
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

const steps = [];
const verbose = !!process.env.E2E_VERBOSE;
let markAt = Date.now();
const mark = (label) => {
  if (verbose) console.log(`       ${label} +${Date.now() - markAt} ms`);
  markAt = Date.now();
};
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    steps.push(`  ok   ${name} (${Date.now() - started} ms)`);
    console.log(steps.at(-1));
  } catch (error) {
    console.log(`  FAIL ${name}`);
    throw error;
  }
}

const env = { ...process.env, RESUMEAPPLYR_USER_DATA: userData, PATH: `${bin}${delimiter}${process.env.PATH}` };
delete env.ELECTRON_RUN_AS_NODE;
const args = [appDir];
// Chromium's sandbox can't start as root, nor on CI runners that restrict user namespaces.
if (process.platform === "linux" && (process.getuid?.() === 0 || process.env.CI)) args.push("--no-sandbox");

const app = await electron.launch({ executablePath: electronPath, args, env, timeout: 60_000 });
const errors = [];
let failed = false;

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  await page.waitForLoadState("domcontentloaded");

  // Rail links can carry a count ("Campaigns 2 waiting for you"), so match the start of the name.
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: new RegExp(`^${name}\\b`) })
      .click();
  const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
  // Segmented controls hide their radio inputs; people click the label.
  const choose = (name) => page.locator("label.seg-opt").filter({ hasText: name }).first().click();
  const toast = (text) => page.locator(".toasts").getByText(text).first().waitFor();
  const stubSave = (path) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, path);

  await step("home opens with the setup checklist", async () => {
    await page.getByRole("heading", { name: "Today", level: 1 }).waitFor();
    await page.getByText("Before the first campaign").waitFor();
    await page.getByText("Claude Code is ready").waitFor({ timeout: 30_000 });
    await shot("01-home-first-run");
  });

  await step("profile saves", async () => {
    await nav("Profile");
    await page.getByLabel("First name", { exact: true }).fill("Asha");
    await page.getByLabel("Last name", { exact: true }).fill("Verma");
    await page.getByLabel("Email for applications", { exact: true }).fill("asha.verma@example.com");
    await page.getByLabel("Phone", { exact: true }).fill("+49 30 1234567");
    await page.getByLabel("City", { exact: true }).fill("Berlin");
    await page.getByLabel("Country", { exact: true }).fill("Germany");
    await page.getByLabel("Countries you can work in without sponsorship", { exact: true }).fill("Germany, Ireland");
    await page.getByRole("button", { name: "Add a range" }).click();
    await page.getByLabel("From", { exact: true }).fill("70000");
    await page.getByLabel("To", { exact: true }).fill("90000");
    await page.getByLabel("Currency", { exact: true }).fill("EUR");
    await page.getByRole("button", { name: "Save profile" }).click();
    await toast("Profile saved.");
    await shot("02-profile");
  });

  await step("a CV written in the app saves and previews", async () => {
    await nav("CVs");
    await page.getByRole("button", { name: "Start from scratch" }).first().click();
    await page.getByLabel("Full name", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Full name", { exact: true }).inputValue(), "Asha Verma", "the blank CV starts from the profile");
    await page.getByLabel("Headline", { exact: true }).fill("Frontend engineer");
    await page.getByRole("button", { name: "Add a role" }).click();
    await page.getByLabel("Job title", { exact: true }).fill("Frontend Engineer");
    await page.getByLabel("Company", { exact: true }).fill("Sternwarte Software");
    await page.getByLabel("Started", { exact: true }).first().fill("Mar 2021");
    await page.getByLabel("Ended", { exact: true }).first().fill("Present");
    await page
      .getByLabel("What you did", { exact: true })
      .fill("Built the React component library used by 14 product teams\nCut page load time by 38% by moving to server rendering");
    await page.getByRole("button", { name: "Add a skill group" }).click();
    await page.getByLabel("Group", { exact: true }).fill("Frontend");
    await page.getByLabel("Skills in this group", { exact: true }).fill("React, TypeScript, Design systems, Accessibility");
    await page.getByRole("button", { name: "Save CV" }).click();
    await toast("CV saved.");
    await page.frameLocator('iframe[title="CV preview"]').getByText("Sternwarte Software").waitFor();
    await shot("03-cv-editor");
  });

  await step("the CV exports as a PDF", async () => {
    const pdf = join(work, "exported.pdf");
    await stubSave(pdf);
    await choose(/^Preview$/);
    await page.frameLocator('iframe[title="CV preview"]').getByText("Asha Verma").waitFor();
    await shot("04-cv-preview");
    await page.getByRole("button", { name: "Save as PDF" }).click();
    await toast("PDF saved.");
    assert.ok(existsSync(pdf), "the PDF was written");
    assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-", "the file is a PDF");
  });

  await step("an uploaded PDF waits to be read", async () => {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, samplePdf);
    await page.getByRole("button", { name: "Upload a PDF" }).click();
    await toast("PDF added.");
    await page.getByText("The agent hasn't read this PDF yet.").waitFor();
    await page.getByRole("button", { name: "Read my CV" }).waitFor();
  });

  await step("a campaign starts and the agent's question gets answered", async () => {
    await nav("Campaigns");
    await page.getByRole("heading", { name: "No campaigns yet" }).waitFor();
    await page.getByRole("link", { name: "New campaign" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New campaign" });
    await dialog.getByLabel("Search for", { exact: true }).fill("Frontend engineer, Berlin");
    await dialog.getByLabel("CV to start from", { exact: true }).selectOption({ label: "My CV (main)" });
    await shot("05-new-campaign");
    mark("dialog filled");
    await dialog.getByRole("button", { name: "Create and start" }).click();
    await toast("Campaign created. The agent is starting.");
    mark("created");
    await page.getByRole("heading", { name: "Frontend engineer, Berlin", level: 1 }).waitFor();
    mark("campaign page");
    await page.getByText("Enter the code the job board just emailed you.").waitFor({ timeout: 30_000 });
    mark("question shown");
    await shot("06-agent-question");
    await page.getByLabel("Your answer", { exact: true }).fill("482913");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    mark("answered");
    await page.getByRole("button", { name: "Senior Frontend Engineer" }).waitFor({ timeout: 30_000 });
    mark("jobs shown");
    await page.getByRole("button", { name: "Frontend Developer" }).waitFor();
  });

  await step("approving a job and applying records the application", async () => {
    await page.locator(".rail-agent").getByText("The agent is idle").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Senior Frontend Engineer" }).click();
    await page.getByText("Why this score").waitFor();
    await shot("07-campaign-jobs");
    await page.getByRole("row", { name: /Senior Frontend Engineer/ }).getByRole("button", { name: "Approve" }).click();
    await toast("Approved 1 job.");
    await page.getByRole("button", { name: "Apply to approved (1)" }).click();
    await page.locator(".rail-agent").getByText("Working").waitFor();
    await page.locator(".rail-agent").getByText("The agent is idle").waitFor({ timeout: 30_000 });
    await page.locator("label.seg-opt").filter({ hasText: /^Applied 1$/ }).waitFor({ timeout: 30_000 });
    await choose(/^Applied 1$/);
    await page.getByRole("button", { name: "Senior Frontend Engineer" }).waitFor();
    await shot("08-campaign-applied");
  });

  await step("the application shows in Applications", async () => {
    await nav("Applications");
    await page.getByRole("button", { name: "Senior Frontend Engineer" }).waitFor();
    await shot("09-applications");
    await page.getByRole("button", { name: "Senior Frontend Engineer" }).click();
    const dialog = page.getByRole("dialog", { name: /Senior Frontend Engineer/ });
    await dialog.getByLabel("Change status", { exact: true }).selectOption("interviewing");
    await toast("Status changed.");
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  await step("the agent's runs are listed with their steps", async () => {
    await nav("Agent");
    await page.getByRole("link", { name: /Search linkedin\.com/ }).click();
    await page.getByText("Signed in, Asha. Reading the results.").waitFor();
    await shot("10-agent-run");
  });

  await step("settings show the AI tool and save rules", async () => {
    await nav("Settings");
    await page.getByText("Found: 2.1.296 (Claude Code).").waitFor();
    await choose("Send on its own above a score");
    await page.getByLabel("Auto-send score", { exact: true }).fill("85");
    await page.getByRole("button", { name: "Save rules" }).click();
    await toast("Rules saved.");
    await shot("11-settings");
  });

  await step("home reflects the work", async () => {
    await nav("Home");
    await page.getByText("Interviews and offers").waitFor();
    await shot("12-home-after");
    const sent = await page.locator(".stat").first().locator(".stat-value").textContent();
    assert.equal(sent?.trim(), "1", "one application sent today");
  });

  await step("an application sent elsewhere is recorded", async () => {
    await nav("Applications");
    await page.getByRole("button", { name: "Add one you sent yourself" }).click();
    const dialog = page.getByRole("dialog", { name: "Add an application you sent yourself" });
    await dialog.getByLabel("Link to the posting", { exact: true }).fill("https://careers.example.org/jobs/42?utm_source=newsletter");
    await dialog.getByLabel("Job title", { exact: true }).fill("Design Engineer");
    await dialog.getByLabel("Company", { exact: true }).fill("Example Org");
    await dialog.getByRole("button", { name: "Add application" }).click();
    await toast("Added. The agent will skip this job.");
    await page.getByRole("button", { name: "Design Engineer" }).waitFor();
  });

  await step("a campaign from pasted links waits to be scored", async () => {
    await nav("Campaigns");
    await page.getByRole("link", { name: "New campaign" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New campaign" });
    await dialog.locator("label.seg-opt").filter({ hasText: "Apply to links" }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Links from friends");
    await dialog
      .getByLabel("Job links", { exact: true })
      .fill("https://boards.example.com/acme/123\nhttps://jobs.example.net/globex/frontend");
    await dialog.getByRole("button", { name: "Create without starting" }).click();
    await page.getByRole("heading", { name: "Links from friends", level: 1 }).waitFor();
    await page.locator("label.seg-opt").filter({ hasText: /^Not opened yet 2$/ }).waitFor();
    await page.getByRole("button", { name: "Score the links" }).waitFor();
    await shot("13-links-campaign");
  });

  assert.deepEqual(errors, [], "the window logged no errors");
} catch (error) {
  failed = true;
  console.error(error);
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(shots, "failure.png") });
    console.error(`Screenshot of the failure: ${join(shots, "failure.png")}`);
  } catch {
    // The window may be gone.
  }
  if (errors.length) console.error("Window errors:\n" + errors.join("\n"));
} finally {
  await app.close().catch(() => {});
}

console.log(`\n${steps.length} steps passed. Screenshots: ${shots}`);
if (!process.env.E2E_KEEP) {
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    // Windows may still hold the database for a moment.
  }
}
process.exit(failed ? 1 : 0);
