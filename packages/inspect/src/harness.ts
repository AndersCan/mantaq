/**
 * Drive a machine on the live viz in headless Chromium: build the file's page,
 * open it, send events by name, read the state and the
 * findings, take a screenshot. Internal: not exported from the package.
 *
 * The harness does not wait for a real effect's later answer: the live driver
 * holds effects, so an effect only reports when the caller sends its event.
 */
import { actorMapOf, machineFindings, movesFrom, parseViz, scopeOf } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import type {
  VizActorRef,
  VizEdge,
  VizFinding,
  VizJson,
  VizLiveOutcome,
  VizMachine,
} from "@mantaq/viz";
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
  /** Open the Details of the event's arrow out of the current state and press its Send, as a person would. An event with no arrow from here is a Left naming the events that have one; an arrow whose guard blocks it is a Left with the reason, and nothing is sent. A payload is typed into the arrow's send form and stays set for later sends of the event, as a person's would. */
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
type Locator = ReturnType<Page["locator"]>;
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

/** Type `payload` into an arrow's send form (empty text drops a change); a message when a key has no box. */
async function typePayload(
  form: Locator,
  payload: Record<string, VizJson | undefined>,
): Promise<string | undefined> {
  for (const [key, value] of Object.entries(payload)) {
    const box = form.locator(`[data-value=${quoted(key)}]`);
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

/** The real states the diagram marks current: a state node's id, and for a folded group node the state of the walk inside it. */
function currentStates(page: Page): Promise<string[]> {
  return page
    .locator(".graph g.state.current[data-node-id]")
    .evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          node.getAttribute("data-current-state") ?? node.getAttribute("data-node-id") ?? "",
      ),
    );
}

/** Local state names of every region, read from the diagram's current states. */
async function readRegions(page: Page, machine: VizMachine): Promise<Record<string, string>> {
  const ids = await currentStates(page);
  const entries = ids.flatMap((id) => {
    const dot = id.lastIndexOf(".");
    if (dot === -1) return [];
    const scope = id.slice(0, dot);
    const inMap = actorMapOf(id, machine) !== undefined;
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
  if (path === "") return undefined;
  const regions = Object.keys(await readRegions(page, machine));
  if (regions.includes(path)) return undefined;
  const names = regions.join(", ");
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

/** Follow the worker's row on the Step tab; its state id. */
async function pressRow(page: Page, actor: { map: string; key: string }): Promise<string> {
  await page.click('[data-tab="step"]');
  const row = `${PANEL} [data-child-map=${quoted(actor.map)}][data-child-key=${quoted(actor.key)}]`;
  await page.click(row);
  return (await page.getAttribute(row, "data-child-state")) ?? "";
}

interface PressOptions {
  edges: VizEdge[];
  event: string;
  state: () => Promise<string>;
  payload: Record<string, VizJson> | undefined;
}

/** Opens each arrow's Details in turn, types the payload into the first send form, and presses the first Send whose arrow is not locked; else the first reason given. */
async function pressFirstSend(
  page: Page,
  from: PressOptions,
): Promise<Either<string, { state: string; outcome: VizLiveOutcome }>> {
  let note: string | undefined;
  let pending = from.payload ?? {};
  for (const edge of from.edges) {
    await page
      .locator(
        `.graph g[data-details-edge=${quoted(edge.id)}], .graph g.edge-help[data-members*=${quoted(quoted(edge.id))}]`,
      )
      .dispatchEvent("click");
    const form = page.locator(`[data-send-form=${quoted(edge.id)}]`);
    if ((await form.count()) === 0) {
      note ??= (await page.locator("[data-blocked-note]").first().textContent()) ?? undefined;
      continue;
    }
    const problem = await typePayload(form, pending);
    if (problem !== undefined) return Either.left(problem);
    pending = {};
    const lock = form.locator("[data-blocked-note]");
    if ((await lock.count()) > 0) {
      note ??= (await lock.textContent()) ?? undefined;
      continue;
    }
    await form.locator(`[data-send-edge=${quoted(edge.id)}]`).click();
    return outcomeOf(page, from.state);
  }
  return Either.left(note ?? `${from.event} is blocked.`);
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
    const currents = "map" in actor ? [await pressRow(page, actor)] : await currentStates(page);
    const edges = currents
      .flatMap((current) => movesFrom(machine, current))
      .map((move) => move.edge)
      .filter((edge) => scopeOf(edge.from) === ("map" in actor ? actor.map : path));
    const offering = edges.filter((each) => each.event === event);
    if (offering.length === 0) {
      const where =
        "map" in actor
          ? `${path} is in ${await rowState(page, actor)}`
          : path === ""
            ? `${id} is in ${await state()}`
            : `region ${path} is in ${(await readRegions(page, machine))[path]}`;
      const offered = [...new Set(edges.map((each) => each.event))].sort();
      return Either.left(`no button for ${event}: ${where}, which offers: ${offered.join(", ")}.`);
    }
    return pressFirstSend(page, { edges: offering, event, state, payload });
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
    return `${id} is not live: create() built its actor on a clock it was not given. Pass the clock create() gets to Actor({ clock }).`;
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
