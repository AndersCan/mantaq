// @vitest-environment happy-dom
import { mantaqViz } from "./vite.ts";
import { parseViz } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { sendVia } from "./send-via.ts";

let out = "";

beforeAll(async () => {
  out = mkdtempSync(join(import.meta.dirname, "site-"));
  await build({
    root: join(import.meta.dirname, "fixtures"),
    configFile: false,
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true, minify: false },
    plugins: [mantaqViz({ machines: ["retry.ts", "credit.ts"], base: "/", fuzz: false })],
  });
}, 60_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("mantaqViz build", () => {
  test("emits index.html, viz.json and a script", () => {
    const files = readdirSync(out, { recursive: true }).map(String);
    expect(files).toContain("index.html");
    expect(files).toContain("viz.json");
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    const machines = Either.getRight(parseViz(readFileSync(join(out, "viz.json"), "utf8")));
    expect(machines?.machines.map((machine) => machine.id)).toEqual(["credit", "retry"]);
  });

  test("the built page mounts and steps a machine through the driver", async () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    const entry = html.match(/<script type="module" src="([^"]+)"/)?.[1] ?? "";
    expect(entry).not.toBe("");
    document.body.innerHTML = '<main id="app" data-src="viz.json"></main>';
    const text = readFileSync(join(out, "viz.json"), "utf8");
    globalThis.fetch = async () => new Response(text);
    await import(/* @vite-ignore */ pathToFileURL(join(out, entry)).href);
    const root = document.querySelector("#app");
    await vi.waitFor(() => expect(root?.querySelector(".graph g.edge.next")).not.toBeNull());
    expect(root !== null && sendVia(root)).toBe(true);
  });
});

describe("mantaqViz build alongside an app", () => {
  const app = join(import.meta.dirname, "fixtures", "app-site");
  const dist = join(app, "dist");
  const machine = (name: string) => join(import.meta.dirname, "fixtures", name);

  afterAll(() => {
    rmSync(app, { recursive: true, force: true });
  });

  async function buildApp(machines: string[], fuzz: false | { iterations: number }) {
    rmSync(app, { recursive: true, force: true });
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, "index.html"),
      '<!doctype html><script type="module" src="/main.ts"></script>',
    );
    writeFileSync(join(app, "broken.ts"), 'throw new Error("boom");');
    writeFileSync(join(app, "main.ts"), 'console.log("app-main-marker");');
    const warnings: string[] = [];
    await build({
      root: app,
      configFile: false,
      logLevel: "warn",
      customLogger: {
        info() {},
        warn: (message) => void warnings.push(message),
        warnOnce: (message) => void warnings.push(message),
        error() {},
        clearScreen() {},
        hasErrorLogged: () => false,
        hasWarned: false,
      },
      build: { outDir: dist, emptyOutDir: true, minify: false },
      plugins: [mantaqViz({ machines, fuzz })],
    });
    return { files: readdirSync(dist, { recursive: true }).map(String), warnings };
  }

  test("keeps the app entry and writes the page under the default base", async () => {
    const { files } = await buildApp([machine("retry.ts")], false);
    expect(files).toContain("index.html");
    expect(files).toContain(join("__mantaq", "index.html"));
    expect(files).toContain(join("__mantaq", "viz.json"));
    const sources = files
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFileSync(join(dist, file), "utf8"));
    expect(sources.some((source) => source.includes("app-main-marker"))).toBe(true);
    const page = readFileSync(join(dist, "__mantaq", "index.html"), "utf8");
    const entry = page.match(/<script type="module" src="([^"]+)"/)?.[1] ?? "";
    expect(entry.startsWith("../assets/")).toBe(true);
  }, 60_000);

  test("a machine file that throws warns and the build still succeeds", async () => {
    const { files, warnings } = await buildApp(
      [join(app, "broken.ts"), machine("retry.ts")],
      false,
    );
    expect(files).toContain("index.html");
    expect(files).toContain(join("__mantaq", "viz.json"));
    expect(warnings.length).toBeGreaterThan(0);
  }, 60_000);

  test("builds with fuzz enabled", async () => {
    const { files } = await buildApp([machine("retry.ts")], { iterations: 20 });
    expect(files).toContain(join("__mantaq", "viz.json"));
    const text = readFileSync(join(dist, "__mantaq", "viz.json"), "utf8");
    expect(Either.getRight(parseViz(text))?.machines.map((m) => m.id)).toEqual(["retry"]);
  }, 60_000);
});

describe("mantaqViz build with embedded machines", () => {
  const fixtures = join(import.meta.dirname, "fixtures");

  async function vizJson(machines: string[]) {
    const dist = mkdtempSync(join(import.meta.dirname, "site-"));
    await build({
      root: fixtures,
      configFile: false,
      logLevel: "silent",
      build: { outDir: dist, emptyOutDir: true, minify: false },
      plugins: [mantaqViz({ machines, base: "/", fuzz: { iterations: 50 } })],
    });
    const text = readFileSync(join(dist, "viz.json"), "utf8");
    rmSync(dist, { recursive: true, force: true });
    return parseViz(text);
  }

  function shape(parsed: Awaited<ReturnType<typeof vizJson>>) {
    const document = Either.getRight(parsed);
    return {
      issues: Either.getLeft(parsed) ?? [],
      machines: (document?.machines ?? []).map((machine) => ({
        id: machine.id,
        fuzzed: machine.fuzz !== null,
        embeds: machine.states.flatMap((state) =>
          state.machine === undefined ? [] : [[state.id, state.machine]],
        ),
      })),
    };
  }

  test("viz.json holds the machine two states embed, once, and validates", async () => {
    expect(shape(await vizJson(["embedded/delivery.ts"]))).toEqual({
      issues: [],
      machines: [
        {
          id: "delivery",
          fuzzed: true,
          embeds: [
            ["handingOver", "scan"],
            ["pickingUp", "scan"],
          ],
        },
        { id: "scan", fuzzed: true, embeds: [] },
      ],
    });
  }, 60_000);

  test("an embedded machine that a file also exports is in viz.json once", async () => {
    const machines = shape(await vizJson(["embedded/delivery.ts", "embedded/scan.ts"])).machines;
    expect(machines.map((machine) => machine.id)).toEqual(["delivery", "scan"]);
  }, 60_000);
});
