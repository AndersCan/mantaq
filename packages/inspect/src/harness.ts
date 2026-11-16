/**
 * Drive a machine on the live viz in headless Chromium: build the file's page,
 * open it, send events by name, read the state and the
 * findings, take a screenshot. Internal: not exported from the package.
 *
 * The harness does not wait for a real effect's later answer: the live driver
 * holds effects, so an effect only reports when the caller sends its event.
 */
import { Either } from "@mantaq/utils";
import { machineFindings, movesFrom, parseViz, scopeOf } from "@mantaq/viz";
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
  /** Select the event's arrow out of the current state and press Send in Details, as a person would. An event with no arrow from here is a Left naming the events that have one. A payload is typed into the Context tab's value boxes and stay set for later sends, as a person's would. */
  send(
    event: string,
    payload?: Record<string, VizJson>,
  ): Promise<Either<string, { state: string; outcome: VizLiveOutcome }>>;
  /** Where each region is now, by local state name: `{ network: "online", upload: "sendingPhoto" }`. */
  regions(): Promise<Record<string, string>>;
  /** Like `send`, for an arrow in a region or the Send button in a worker's row. An unknown region is a result, not an error. */
  sendTo(
    actor: VizActorRef,
    event: string,
    payload?: Record<string, VizJson>,
  ): Promise<Either<string, { state: string; outcome: VizLiveOutcome }>>;
  /** Every child of every actor map, sorted by map then key, by local state name: `[{ map: "photos", key: "p1", state: "sendingPhoto" }]`. */
  children(): Promise<Array<{ map: string; key: string; state: string }>>;
  findings(): VizFinding[];
  /** The text of the Step tab panel. */
  text(): Promise<string>;
  /** Viewport PNG; written to `path` when given. */
  screenshot(path?: string): Promise<Uint8Array>;
  /** Page errors and console errors so far. */
  problems(): string[];
  /** The browser page, for tests that read layout. */
  page: Page;
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

/** Type `values` into the Context tab's boxes (empty text clears one); returns a message when a key has no box. */
async function setValues(
  page: Page,
  values: Record<string, VizJson | undefined>,
): Promise<string | undefined> {
  const [first] = Object.keys(values);
  if (first === undefined) return undefined;
  if ((await page.locator('[data-tab="context"]').count()) === 0) {
    return `no value box for ${first}.`;
  }
  await page.click('[data-tab="context"]');
  for (const [key, value] of Object.entries(values)) {
    const box = page.locator(`[data-value=${quoted(key)}]`);
    if ((await box.count()) === 0) {
      return `no value box for ${key}.`;
    }
    const text =
      value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    await box.fill(text);
    await box.dispatchEvent("change");
  }
  return undefined;
}

/** Local state names of every region, read from the diagram's current states. */
async function readRegions(page: Page, machine: VizMachine): Promise<Record<string, string>> {
  const ids = await page
    .locator(".graph g.current[data-node-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id") ?? ""));
  const entries = ids.flatMap((id) => {
    const dot = id.lastIndexOf(".");
    if (dot === -1) return [];
    const scope = id.slice(0, dot);
    const inMap = machine.maps.some((map) => scope === map || scope.startsWith(`${map}.`));
    return inMap ? [] : [[scope, id.slice(dot + 1)] as const];
  });
  return Object.fromEntries(entries);
}

async function readChildren(
  page: Page,
): Promise<Array<{ map: string; key: string; state: string }>> {
  const found = await page.locator(".graph").evaluate((graph) => {
    const own = (node: Element) => ({
      map: node.getAttribute("data-marker-map") ?? "",
      key: node.getAttribute("data-marker-key") ?? "",
      state: node.getAttribute("data-marker-state") ?? "",
    });
    const markers = Array.from(graph.querySelectorAll("g.child-marker")).map(own);
    const hidden = Array.from(graph.querySelectorAll("text.marker-count")).flatMap((node) =>
      (node.querySelector("title")?.textContent ?? "")
        .split("\n")
        .map((key) => ({ ...own(node), key })),
    );
    return [...markers, ...hidden];
  });
  return found
    .map(({ map, key, state }) => ({ map, key, state: state.slice(state.lastIndexOf(".") + 1) }))
    .sort(
      (a, b) => a.map.localeCompare(b.map) || a.key.localeCompare(b.key, "en", { numeric: true }),
    );
}

/** Whether the Step tab lists the child `actor`. */
async function walkTo(page: Page, actor: { map: string; key: string }): Promise<boolean> {
  const row = `${PANEL} [data-child-map=${quoted(actor.map)}][data-child-key=${quoted(actor.key)}]`;
  return (await page.locator(row).count()) > 0;
}

/** Why the region or map child `actor` is not on the Step tab; undefined when it is (or for the machine itself). */
async function missingActor(
  page: Page,
  context: { machine: VizMachine; actor: VizActorRef; path: string },
): Promise<string | undefined> {
  const { machine, actor, path } = context;
  const id = machine.id;
  if ("map" in actor) {
    if (await walkTo(page, actor)) return undefined;
    const keys = (await readChildren(page))
      .filter((child) => child.map === actor.map)
      .map((child) => child.key);
    return `no child ${quoted(actor.key)} in ${quoted(actor.map)} of ${id}. Children: ${keys.join(", ")}.`;
  }
  if (path === "" || Object.keys(await readRegions(page, machine)).includes(path)) {
    return undefined;
  }
  const names = Object.keys(await readRegions(page, machine)).join(", ");
  return `no region ${quoted(path)} in ${id}. Regions: ${names}.`;
}

/** The local state name of a worker, from its row on the Step tab. */
async function rowState(page: Page, actor: { map: string; key: string }): Promise<string> {
  const row = `${PANEL} [data-child-map=${quoted(actor.map)}][data-child-key=${quoted(actor.key)}]`;
  const state = await page.getAttribute(row, "data-child-state");
  return (state ?? "").slice((state ?? "").lastIndexOf(".") + 1);
}

/** The outcome of the last Send, read from the Step tab. */
async function outcomeOf(
  page: Page,
  state: () => Promise<string>,
): Promise<Either<string, { state: string; outcome: VizLiveOutcome }>> {
  const outcome =
    (await page.getAttribute(`${PANEL} [data-outcome]`, "data-outcome")) ?? "transition";
  return Either.right({ state: await state(), outcome: outcome as VizLiveOutcome });
}

/** Press the Send button in a worker's row on the Step tab. */
async function pressRow(
  page: Page,
  context: {
    actor: { map: string; key: string };
    event: string;
    payload: Record<string, VizJson> | undefined;
    state: () => Promise<string>;
  },
): Promise<Either<string, { state: string; outcome: VizLiveOutcome }>> {
  const { actor, event, payload, state } = context;
  await page.click('[data-tab="step"]');
  const scope = `${PANEL} [data-actor=${quoted(actorPath(actor))}]`;
  const trigger = page.locator(`${scope} [data-send=${quoted(event)}]`).first();
  if ((await trigger.count()) === 0) {
    const offered = await attributes(page, `${scope} [data-send]`, "data-send");
    return Either.left(
      `no button for ${event}: ${actorPath(actor)} is in ${await rowState(page, actor)}, which offers: ${[...new Set(offered)].join(", ")}.`,
    );
  }
  const problem = payload === undefined ? undefined : await setValues(page, payload);
  if (problem !== undefined) {
    return Either.left(problem);
  }
  await page.click('[data-tab="step"]');
  await trigger.click();
  return outcomeOf(page, state);
}

function makeSend(
  page: Page,
  machine: VizMachine,
  state: () => Promise<string>,
  isClosed: () => boolean,
): VizHarness["sendTo"] {
  const id = machine.id;
  return async (actor, event, payload) => {
    if (isClosed()) {
      return Either.left("harness is closed");
    }
    const path = actorPath(actor);
    const missing = await missingActor(page, { machine, actor, path });
    if (missing !== undefined) return Either.left(missing);
    if ("map" in actor) return pressRow(page, { actor, event, payload, state });
    const currents = await page
      .locator(".graph g.current[data-node-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id") ?? ""));
    const edges = currents
      .flatMap((current) => movesFrom(machine, current))
      .map((move) => move.edge)
      .filter((edge) => scopeOf(edge.from) === path);
    const edge = edges.find((each) => each.event === event);
    if (edge === undefined) {
      const where =
        path === ""
          ? `${id} is in ${await state()}`
          : `region ${path} is in ${(await readRegions(page, machine))[path]}`;
      const offered = [...new Set(edges.map((each) => each.event))].sort();
      return Either.left(`no button for ${event}: ${where}, which offers: ${offered.join(", ")}.`);
    }
    const problem = payload === undefined ? undefined : await setValues(page, payload);
    if (problem !== undefined) {
      return Either.left(problem);
    }
    await page.locator(`.graph g[data-edge-id=${quoted(edge.id)}]`).dispatchEvent("click");
    const trigger = page.locator(`[data-send-edge=${quoted(edge.id)}]`);
    if ((await trigger.count()) === 0) {
      const note = await page.locator("[data-blocked-note]").first().textContent();
      return Either.left(note ?? `${event} is blocked.`);
    }
    await trigger.click();
    return outcomeOf(page, state);
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
    await page.waitForSelector(".viz .graph", { timeout: 10_000 });
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
  const sendTo = makeSend(page, machine, state, lifecycle.isClosed);
  return {
    page,
    state,
    send: (event, payload) => sendTo({ region: "" }, event, payload),
    sendTo,
    regions: () => readRegions(page, machine),
    children: () => readChildren(page),
    findings: () => machineFindings(machine),
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

function actorPath(actor: VizActorRef): string {
  return "region" in actor ? actor.region : `${actor.map}[${actor.key}]`;
}
