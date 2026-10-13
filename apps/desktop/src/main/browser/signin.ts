// A visible browser on the agent's own profile, so the user can sign in to job boards once. The
// agent's browser (Playwright MCP) uses the same folder, so the sign-ins carry over. Only one
// browser can hold a profile at a time: the runner closes this one before a run starts.
import type { BrowserContext } from "playwright-core";
import type { BrowserChannel } from "../../core/schemas/settings";

export class SignInBrowser {
  private context: BrowserContext | null = null;

  constructor(
    private readonly profileDir: string,
    private readonly channel: () => BrowserChannel,
    /** For tests and unusual installs: a browser binary to use instead of the channel. */
    private readonly executablePath = process.env.RESUMEAPPLYR_BROWSER_EXECUTABLE,
  ) {}

  isOpen(): boolean {
    return this.context !== null;
  }

  async open(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) throw new Error("Only web addresses can be opened.");
    if (!this.context) {
      const { chromium } = await import("playwright-core");
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, {
          headless: false,
          viewport: null,
          ...(this.executablePath ? { executablePath: this.executablePath } : { channel: this.channel() }),
          args: ["--no-first-run", "--no-default-browser-check"],
        });
      } catch (error) {
        const name = this.channel() === "msedge" ? "Microsoft Edge" : "Google Chrome";
        throw new Error(
          `Couldn't open ${name}. Install it, or pick the other browser in Settings. (${error instanceof Error ? error.message.split("\n")[0] : error})`,
        );
      }
      this.context.on("close", () => {
        this.context = null;
      });
    }
    const page = this.context.pages().find((p) => p.url() === "about:blank") ?? (await this.context.newPage());
    await page.goto(url);
    await page.bringToFront();
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    await context?.close().catch(() => {});
  }
}
