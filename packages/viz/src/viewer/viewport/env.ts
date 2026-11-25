export interface BrowserTestEnv {
  /** A Chromium to launch instead of Playwright's own download. */
  chromiumPath: string | undefined;
}

/** What the browser tests read from the environment: `CHROMIUM_PATH`. */
export function browserTestEnv(): BrowserTestEnv {
  return { chromiumPath: process.env["CHROMIUM_PATH"] || undefined };
}
