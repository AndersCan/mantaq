/**
 * Drive a machine on the live viz in headless Chromium: build the file's page,
 * open it, send events by name, read the state, what is waiting and the
 * findings, take a screenshot. Internal: not exported from the package.
 *
 * The harness does not wait for a real effect's later answer: the live driver
 * holds effects, so an effect only reports when the caller sends its event.
 */
import { Either } from "@mantaq/utils";
import { machineFindings, parseViz } from "@mantaq/viz";
import type { VizActorRef, VizFinding, VizJson, VizLiveOutcome, VizMachine } from "@mantaq/viz";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { build } from "vite";
import { serve } from "./check-site.ts";
import { mantaqViz } from "./vite.ts";

export interface VizHarness {
  /** The current state id. */
  state(): Promise<string>;
  /** Effects waiting for an answer, with the events each reports. */
  waiting(): Promise<Array<{ effect: string; reports: string[] }>>;
  /** Click what one person would click; an ignored event is a result, not an error. */
  send(
    event: string,
    payload?: Record<string, VizJson>,
  ): Promise<Either<string, { state: string; outcome: VizLiveOutcome }>>;
  /** Where each region is now, by local state name: `{ network: "online", upload: "sendingPhoto" }`. */
  regions(): Promise<Record<string, string>>;
  /** Like `send`, for the Send button under a region. An unknown region is a result, not an error. */
  sendTo(
    actor: VizActorRef,
    event: string,
    payload?: Record<string, VizJson>,
  ): Promise<Either<string, { state: string; outcome: VizLiveOutcome }>>;
  findings(): VizFinding[];
  /** Click the finding's "!" mark, then its Replay button; left when the finding has no replay. */
  replay(finding: VizFinding): Promise<Either<string, { state: string }>>;
  /** The text of the Step tab panel. */
  text(): Promise<string>;
  /** Viewport PNG; written to `path` when given. */
  screenshot(path?: string): Promise<Uint8Array>;
  /** Page errors and console errors so far. */
  problems(): string[];
  /** Idempotent: page, browser, server, temp dir. */
  close(): Promise<void>;
}

export interface OpenVizOptions {
  /** Absolute path to a machine file. */
  file: string;
  /** Machine id; optional when the file has one machine. */
  machine?: string;
  /** Default 1280 x 720. */
  viewport?: { width: number; height: number };
}

const PANEL = '[data-tab-panel="step"]';

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

type Page = import("playwright").Page;
type Browser = import("playwright").Browser;

function pickMachine(
  machines: VizMachine[],
  name: string,
  wanted: string | undefined,
): Either<string, VizMachine> {
  const ids = machines.map((each) => each.id);
  const found =
    wanted === undefined
      ? machines.length === 1
        ? machines[0]
        : undefined
      : machines.find((each) => each.id === wanted);
  if (found !== undefined) {
    return Either.right(found);
  }
  if (machines.length === 0) {
    return Either.left(`${name} has no machine the inspector can read.`);
  }
  if (wanted === undefined) {
    return Either.left(`${name} has machines ${ids.join(", ")}: pass machine.`);
  }
  return Either.left(`no machine "${wanted}" in ${name}. Found: ${ids.join(", ")}.`);
}

async function attributes(page: Page, selector: string, attribute: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((nodes, name) => nodes.map((node) => node.getAttribute(name) ?? ""), attribute);
}

/** Fill the open payload form for `event`; returns a message when a key has no field. */
async function fillForm(
  page: Page,
  event: string,
  payload: Record<string, VizJson>,
): Promise<string | undefined> {
  const form = page.locator(`[data-payload-form=${quoted(event)}]`);
  const jsonBox = page.locator(`[data-payload-json=${quoted(event)}]`);
  if ((await jsonBox.count()) > 0) {
    await jsonBox.fill(JSON.stringify(payload));
    return undefined;
  }
  for (const [key, value] of Object.entries(payload)) {
    const field = form.locator(`[data-field=${quoted(key)}]`);
    if ((await field.count()) === 0) {
      const names = await attributes(
        page,
        `[data-payload-form=${quoted(event)}] [data-field]`,
        "data-field",
      );
      await page.click(`[data-payload-cancel=${quoted(event)}]`);
      return `${event} has no field ${key}. Fields: ${names.join(", ")}.`;
    }
    const tag = await field.evaluate((node) => node.tagName.toLowerCase());
    if (tag === "select") {
      await field.selectOption(JSON.stringify(value));
    } else {
      await field.fill(typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  return undefined;
}

/** Click through the payload form (or custom JSON box); returns a message when it cannot. */
async function sendWithPayload(
  page: Page,
  scope: string,
  step: { event: string; payload: Record<string, VizJson> | undefined; asks: boolean },
): Promise<string | undefined> {
  const { event, payload, asks } = step;
  const trigger = page.locator(`${scope} [data-send=${quoted(event)}]`).first();
  const sendButton = page.locator(`[data-payload-send=${quoted(event)}]`);
  if (payload === undefined) {
    await trigger.click();
    if ((await page.locator(`[data-payload-form=${quoted(event)}]`).count()) > 0) {
      await sendButton.click();
    }
    return undefined;
  }
  if (asks) {
    await trigger.click();
    const problem = await fillForm(page, event, payload);
    if (problem === undefined) {
      await sendButton.click();
    }
    return problem;
  }
  const custom = page.locator(`[data-send-custom=${quoted(event)}]`);
  if ((await custom.count()) === 0) {
    return `${event} takes no payload.`;
  }
  await custom.click();
  await page.locator(`[data-payload-json=${quoted(event)}]`).fill(JSON.stringify(payload));
  await sendButton.click();
  return undefined;
}

/** Local state names of every region, read from the Step tab's region lines. */
async function readRegions(page: Page): Promise<Record<string, string>> {
  await page.click('[data-tab="step"]');
  const lines = await page
    .locator(`${PANEL} p[data-region][data-region-state]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => [
        node.getAttribute("data-region") ?? "",
        node.getAttribute("data-region-state") ?? "",
      ]),
    );
  return Object.fromEntries(
    lines.map(([path = "", id = ""]) => [path, id.slice(id.lastIndexOf(".") + 1)]),
  );
}

function makeSend(
  page: Page,
  id: string,
  state: () => Promise<string>,
  isClosed: () => boolean,
): VizHarness["sendTo"] {
  return async (actor, event, payload) => {
    if (isClosed()) {
      return Either.left("harness is closed");
    }
    await page.click('[data-tab="step"]');
    const path = actor.region;
    const scope =
      path === ""
        ? `${PANEL} :is([data-actor=""], .explore-waiting)`
        : `${PANEL} [data-actor=${quoted(path)}]`;
    if (
      path !== "" &&
      (await page.locator(`${PANEL} p[data-region=${quoted(path)}]`).count()) === 0
    ) {
      const names = Object.keys(await readRegions(page)).join(", ");
      return Either.left(`no region ${quoted(path)} in ${id}. Regions: ${names}.`);
    }
    const trigger = page.locator(`${scope} [data-send=${quoted(event)}]`).first();
    if ((await trigger.count()) === 0) {
      const offered = await attributes(page, `${scope} [data-send]`, "data-send");
      const where =
        path === ""
          ? `${id} is in ${await state()}`
          : `region ${path} is in ${(await readRegions(page))[path]}`;
      return Either.left(
        `no button for ${event}: ${where}, which offers: ${[...new Set(offered)].join(", ")}.`,
      );
    }
    const asks = ((await trigger.textContent()) ?? "").trim().endsWith("…");
    const problem = await sendWithPayload(page, scope, { event, payload, asks });
    if (problem !== undefined) {
      return Either.left(problem);
    }
    const alert = page.locator(`[data-payload-form=${quoted(event)}] [role="alert"]:visible`);
    if ((await alert.count()) > 0) {
      const text = ((await alert.first().textContent()) ?? "").trim();
      await page.click(`[data-payload-cancel=${quoted(event)}]`);
      return Either.left(`${event} was not sent: ${text}`);
    }
    const outcome =
      (await page.getAttribute(`${PANEL} [data-outcome]`, "data-outcome")) ?? "transition";
    return Either.right({ state: await state(), outcome: outcome as VizLiveOutcome });
  };
}

async function buildPage(file: string, dir: string): Promise<Either<string, VizMachine[]>> {
  const dist = join(dir, "dist");
  try {
    await build({
      root: dir,
      configFile: false,
      logLevel: "silent",
      build: { outDir: dist, emptyOutDir: true, minify: false },
      plugins: [mantaqViz({ machines: [file], base: "/" })],
    });
  } catch (error) {
    return Either.left(`could not build the live page for ${basename(file)}: ${firstLine(error)}`);
  }
  const parsed = parseViz(readFileSync(join(dist, "viz.json"), "utf8"));
  return Either.right(Either.getRight(parsed)?.machines ?? []);
}

async function launch(): Promise<Either<string, Browser>> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    return Either.left(
      "needs the playwright package: npm i -D playwright && npx playwright install chromium",
    );
  }
  try {
    return Either.right(
      await playwright.chromium.launch({
        executablePath: process.env["CHROMIUM_PATH"] || undefined,
      }),
    );
  } catch (error) {
    return Either.left(
      `could not start Chromium (${firstLine(error)}). Run vp exec -F @mantaq/inspect playwright install chromium, or set CHROMIUM_PATH.`,
    );
  }
}

async function drawPanel(page: Page, id: string, problems: string[]): Promise<string | undefined> {
  try {
    await page.waitForSelector(".explore[data-current]", { timeout: 10_000 });
  } catch {
    return `${id} did not draw a panel. Page problems: ${problems.length === 0 ? "none" : problems.join("; ")}.`;
  }
  if ((await page.$("[data-live-note]")) === null) {
    return `${id} is not live: export a factory that takes a VirtualClock (see the @mantaq/inspect README).`;
  }
  return undefined;
}

function describe(
  page: Page,
  machine: VizMachine,
  problems: string[],
  lifecycle: { close: () => Promise<void>; isClosed: () => boolean },
): VizHarness {
  const state = async () =>
    (await page.getAttribute(".explore[data-current]", "data-current")) ?? "";
  const sendTo = makeSend(page, machine.id, state, lifecycle.isClosed);
  return {
    state,
    waiting: () =>
      page.locator(`${PANEL} [data-waiting-on]`).evaluateAll((nodes) =>
        nodes.map((node) => ({
          effect: node.getAttribute("data-waiting-on") ?? "",
          reports: [...node.querySelectorAll("[data-send]")].map(
            (each) => each.getAttribute("data-send") ?? "",
          ),
        })),
      ),
    send: (event, payload) => sendTo({ region: "" }, event, payload),
    sendTo,
    regions: () => readRegions(page),
    findings: () => machineFindings(machine),
    replay: async (finding) => {
      if (lifecycle.isClosed()) {
        return Either.left("harness is closed");
      }
      if (finding.state === null || (finding.steps?.length ?? 0) === 0) {
        return Either.left(`${finding.title} has nothing to replay.`);
      }
      await page.click(`.finding-mark[data-state=${quoted(finding.state)}]`);
      const button = page.locator(
        `article.finding[data-kind=${quoted(finding.kind)}][data-state=${quoted(finding.state)}] [data-replay]`,
      );
      if ((await button.count()) === 0) {
        return Either.left(`no Replay button for ${finding.title}.`);
      }
      await button.first().click();
      return Either.right({ state: await state() });
    },
    text: async () => {
      await page.click('[data-tab="step"]');
      return page.locator(PANEL).innerText();
    },
    screenshot: async (path) => {
      const bytes = await page.screenshot();
      if (path !== undefined) {
        writeFileSync(path, bytes);
      }
      return bytes;
    },
    problems: () => [...problems],
    close: lifecycle.close,
  };
}

export async function openViz(options: OpenVizOptions): Promise<Either<string, VizHarness>> {
  const dir = mkdtempSync(join(tmpdir(), "mantaq-harness-"));
  const opened: { browser?: Browser; server?: Server } = {};
  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await opened.browser?.close().catch(() => undefined);
    const server = opened.server;
    if (server !== undefined) {
      await new Promise((done) => server.close(done));
    }
    rmSync(dir, { recursive: true, force: true });
  };
  const fail = async (message: string) => {
    await close();
    return Either.left(message);
  };

  const built = await buildPage(options.file, dir);
  const machines = Either.getRight(built);
  if (machines === undefined) {
    return fail(String(Either.getLeft(built)));
  }
  const picked = pickMachine(machines, basename(options.file), options.machine);
  const machine = Either.getRight(picked);
  if (machine === undefined) {
    return fail(String(Either.getLeft(picked)));
  }
  const launched = await launch();
  opened.browser = Either.getRight(launched);
  if (opened.browser === undefined) {
    return fail(String(Either.getLeft(launched)));
  }
  try {
    const { server, origin } = await serve(join(dir, "dist"), "/");
    opened.server = server;
    const page = await opened.browser.newPage({
      viewport: options.viewport ?? { width: 1280, height: 720 },
    });
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        problems.push(message.text());
      }
    });
    await page.goto(`${origin}/?machine=${encodeURIComponent(machine.id)}`);
    const unready = await drawPanel(page, machine.id, problems);
    if (unready !== undefined) {
      return fail(unready);
    }
    return Either.right(describe(page, machine, problems, { close, isClosed: () => closed }));
  } catch (error) {
    return fail(`could not open ${machine.id}: ${firstLine(error)}`);
  }
}
