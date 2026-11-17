/**
 * Vite plugin: a live page of your machines on your own dev server.
 *
 *   // vite.config.ts
 *   import { mantaqViz } from "@mantaq/inspect/vite";
 *   export default defineConfig({ plugins: [mantaqViz({ machines: "src/**\/*.machine.ts" })] });
 *
 * `vite build` with the plugin also writes the page as a static site
 * (`index.html`, `viz.json`, a script) under `base`.
 *
 * Open `/__mantaq/` while the dev server runs. Machines load through your own
 * Vite config (aliases, tsconfig paths), are inspected on the server, and the
 * page redraws, keeping the walk, when you save a file.
 */
import { UPDATE_EVENT, livePageHtml, serializeViz } from "@mantaq/viz";
import type { FuzzSettings } from "./inspect.ts";
import { projectRoot, vizDocument } from "./inspect.ts";
import { analyzeModule } from "./ast/annotate.ts";
import { entryId, inspectEntry, inspectFile, runOf } from "./load.ts";
import { Either } from "@mantaq/utils";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { searchForWorkspaceRoot } from "vite";
import type { Plugin, ViteDevServer } from "vite";

export const STYLESHEETS = ["@mantaq/viz/viewer.css", "@mantaq/viz/page.css"];

export interface MantaqVizOptions {
  /** Files that export machines: paths or globs, relative to the Vite root. */
  machines: string | string[];
  /** Where the page is served. Default `/__mantaq/`. */
  base?: string;
  /**
   * `false` = structure only. Default in dev: `{ timeLimitMs: 2000 }`, ending early on
   * full coverage, so a save redraws fast. `vite build` defaults to `inspect`'s fixed
   * 2000 iterations, so the written `viz.json` is reproducible.
   */
  fuzz?: false | FuzzSettings;
}

/** Dev fuzz budget per machine: small machines stop at full coverage in milliseconds. */
const DEV_FUZZ: FuzzSettings = { timeLimitMs: 2000 };

export const TARGETS = "virtual:mantaq/targets";
export const TARGETS_RESOLVED = `\0${TARGETS}`;
const PREVIEWS = "virtual:mantaq/previews";
const PREVIEWS_RESOLVED = `\0${PREVIEWS}`;

/** `<stem>.preview.ts` beside a machine file, when it exists. */
function previewFileOf(machineFile: string): string | undefined {
  const file = `${machineFile.replace(/\.[^./\\]+$/, "")}.preview.ts`;
  return existsSync(file) ? file : undefined;
}

/** Each machine id of the files that have a preview file, with that file. */
function previewsOf(files: ReadonlyArray<string>): Map<string, string> {
  const previews = new Map<string, string>();
  for (const file of files) {
    const preview = previewFileOf(file);
    if (preview === undefined) continue;
    const analysis = analyzeModule({ file, root: projectRoot(file) });
    if (Either.isLeft(analysis)) continue;
    for (const found of analysis[1].machines) previews.set(found.id, preview);
  }
  return previews;
}

/** Source of `virtual:mantaq/previews`: a lazy import of each preview file, by machine id. */
function previewsSource(files: ReadonlyArray<string>): string {
  const entries = [...previewsOf(files)].map(
    ([id, file]) => `  ${JSON.stringify(id)}: () => import(${JSON.stringify(file)}),`,
  );
  return ["export const previews = {", ...entries, "};"].join("\n");
}

/**
 * Source of `virtual:mantaq/targets`: one entry per `machine(...)` export.
 * The page owns the clock: it hands a VirtualClock to `create({ clock })`.
 */
export function targetsSource(files: ReadonlyArray<string>): string {
  const core = fileURLToPath(import.meta.resolve("@mantaq/core"));
  const imports: string[] = [];
  const entries: string[] = [];
  files.forEach((file, index) => {
    const analysis = analyzeModule({ file, root: projectRoot(file) });
    if (Either.isLeft(analysis)) return;
    const machines = analysis[1].machines;
    if (machines.length === 0) return;
    imports.push(`import * as m${index} from ${JSON.stringify(file)};`);
    for (const found of machines) {
      entries.push(
        `  ${JSON.stringify(found.id)}: () => { const clock = VirtualClock(); const made = m${index}[${JSON.stringify(found.name)}].create({ clock }); const actor = ${found.unwrap === "actor" ? "made.actor" : "made"}; return { actor, clock, made }; },`,
      );
    }
  });
  return [
    `import { VirtualClock } from ${JSON.stringify(core)};`,
    ...imports,
    "export const targets = {",
    ...entries,
    "};",
    `export const previewed = ${JSON.stringify([...previewsOf(files).keys()])};`,
  ].join("\n");
}

function machineFiles(root: string, patterns: ReadonlyArray<string>): string[] {
  const files = patterns
    .flatMap((pattern) => globSync(pattern, { cwd: root }))
    .filter((file) => !file.endsWith(".preview.ts"));
  return [...new Set(files.map((file) => (isAbsolute(file) ? file : resolve(root, file))))].sort();
}

interface Built {
  text: string;
}

async function documentText(
  server: ViteDevServer,
  context: { files: ReadonlyArray<string>; fuzz: false | FuzzSettings },
): Promise<{
  text: string;
  warnings: string[];
}> {
  const results = [];
  for (const file of context.files) {
    const run = runOf(await server.ssrLoadModule(entryId(file)));
    const result =
      run === null
        ? { machines: [], warnings: [`${file}: could not load the inspector`] }
        : await run({ fuzz: context.fuzz });
    results.push(result);
  }
  return {
    text: serializeViz(vizDocument(results.flatMap((result) => result.machines))),
    warnings: results.flatMap((result) => result.warnings),
  };
}

/** The frame page: the app's preview entry on an empty, inert body. */
function servePreview(
  server: ViteDevServer,
  http: { request: IncomingMessage; response: ServerResponse },
): void {
  const { request, response } = http;
  const frame = previewEntry();
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>mantaq screen</title></head><body style="margin:0" inert><script type="module" src="/@fs${frame}"></script></body></html>`;
  void server.transformIndexHtml(request.url ?? "/", page).then((html) => {
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
}

function stylesheets(): string {
  return STYLESHEETS.map((id) => readFileSync(fileURLToPath(import.meta.resolve(id)), "utf8")).join(
    "\n",
  );
}

/** Build mode: write the page, `viz.json` and the viewer script under `base`. */
function siteBuild(context: {
  base: string;
  patterns: ReadonlyArray<string>;
  fuzz: false | FuzzSettings;
  live: string;
  project: { configFile: string | undefined };
  root: () => string;
}): Plugin {
  let standalone = false;
  return {
    name: "mantaq-viz-build",
    apply: "build",
    // Never replace the app's own entry: only stand in as the input when the
    // project has none (no `input` and no root index.html).
    config: (config) => {
      const input = config.build?.rollupOptions?.input;
      const root = resolve(config.root ?? process.cwd());
      standalone = input === undefined && !existsSync(resolve(root, "index.html"));
      return standalone
        ? { build: { rollupOptions: { input: { "mantaq-live": context.live } } } }
        : {};
    },
    buildStart() {
      if (!standalone) this.emitFile({ type: "chunk", id: context.live, name: "mantaq-live" });
    },
    async generateBundle(_options, bundle) {
      const results = [];
      for (const file of machineFiles(context.root(), context.patterns)) {
        const load = { config: context.project.configFile };
        try {
          results.push(await inspectFile(file, { fuzz: context.fuzz }, load));
        } catch (error) {
          this.warn(`[mantaq-viz] ${file}: could not inspect (${String(error)})`);
        }
      }
      for (const warning of results.flatMap((result) => result.warnings)) {
        this.warn(`[mantaq-viz] ${warning}`);
      }
      const text = serializeViz(vizDocument(results.flatMap((result) => result.machines)));
      const dir = context.base.replace(/^\//, "");
      const entry = Object.values(bundle).find(
        (chunk) => chunk.type === "chunk" && chunk.isEntry && chunk.name === "mantaq-live",
      );
      if (entry === undefined) {
        this.error("[mantaq-viz] the live page entry was not bundled");
        return;
      }
      this.emitFile({ type: "asset", fileName: `${dir}viz.json`, source: text });
      this.emitFile({
        type: "asset",
        fileName: `${dir}index.html`,
        source: livePageHtml({
          title: "mantaq viz",
          source: "viz.json",
          entry: posix.relative(dir === "" ? "." : dir, entry.fileName),
          css: stylesheets(),
        }),
      });
    },
  };
}

function resolveVirtual(id: string): string | null {
  if (id === TARGETS) return TARGETS_RESOLVED;
  return id === PREVIEWS ? PREVIEWS_RESOLVED : null;
}

function loadVirtual(id: string, files: () => ReadonlyArray<string>): string | null {
  if (id === TARGETS_RESOLVED) return targetsSource(files());
  return id === PREVIEWS_RESOLVED ? previewsSource(files()) : null;
}

function invalidateVirtual(server: ViteDevServer): void {
  for (const id of [TARGETS_RESOLVED, PREVIEWS_RESOLVED]) {
    const module = server.moduleGraph.getModuleById(id);
    if (module !== undefined) server.moduleGraph.invalidateModule(module);
  }
}

function liveEntry(): string {
  const name = import.meta.url.endsWith(".ts") ? "./live-entry.ts" : "./live-entry.mjs";
  return fileURLToPath(import.meta.resolve(name));
}

function previewEntry(): string {
  const name = import.meta.url.endsWith(".ts") ? "./preview-entry.ts" : "./preview-entry.mjs";
  return fileURLToPath(import.meta.resolve(name));
}

export function mantaqViz(options: MantaqVizOptions): Plugin[] {
  const base = (options.base ?? "/__mantaq/").replace(/\/?$/, "/");
  const patterns = Array.isArray(options.machines) ? options.machines : [options.machines];
  const fuzz = options.fuzz ?? DEV_FUZZ;
  const live = liveEntry();
  let root = process.cwd();
  const project: { configFile: string | undefined } = { configFile: undefined };
  const targets: Plugin = {
    name: "mantaq-viz-targets",
    configResolved: (config) => {
      root = config.root;
      project.configFile = config.configFile;
    },
    resolveId: resolveVirtual,
    load: (id) => loadVirtual(id, () => machineFiles(root, patterns)),
  };
  const plugin: Plugin = {
    name: "mantaq-viz",
    apply: "serve",
    // Setting `allow` drops Vite's default (the workspace root), so keep it.
    config: (config) => ({
      server: {
        fs: {
          allow: [
            searchForWorkspaceRoot(config.root ?? process.cwd()),
            dirname(dirname(live)),
            dirname(dirname(fileURLToPath(import.meta.resolve("@mantaq/viz/viewer")))),
          ],
        },
      },
    }),
    configureServer(server) {
      let cached: Promise<Built> | null = null;
      const build = async (): Promise<Built> => {
        const files = machineFiles(server.config.root, patterns);
        const { text, warnings } = await documentText(server, { files, fuzz });
        for (const warning of warnings) server.config.logger.warn(`[mantaq-viz] ${warning}`);
        return { text };
      };
      server.watcher.on("all", (_event, path) => {
        if (!/\.[cm]?[jt]sx?$/.test(path) && !/[\\/]__runs__[\\/][^\\/]+\.json$/.test(path)) return;
        cached = null;
        invalidateVirtual(server);
        server.environments.ssr.moduleGraph.invalidateAll();
        server.ws.send({ type: "custom", event: UPDATE_EVENT });
      });
      server.middlewares.use((request, response, next) => {
        const [path] = (request.url ?? "").split("?");
        if (path === `${base}viz.json`) {
          cached ??= build();
          cached.then(
            ({ text }) => {
              response.setHeader("content-type", "application/json");
              response.end(text);
            },
            (error: unknown) => {
              cached = null;
              response.statusCode = 500;
              response.end(String(error));
            },
          );
          return;
        }
        if (path === `${base}preview`) {
          servePreview(server, { request, response });
          return;
        }
        if (path !== base && path !== base.slice(0, -1)) {
          next();
          return;
        }
        const html = livePageHtml({
          title: "mantaq viz",
          source: `${base}viz.json`,
          entry: `/@fs${live}`,
          css: stylesheets(),
        });
        void server.transformIndexHtml(request.url ?? base, html).then((page) => {
          response.setHeader("content-type", "text/html");
          response.end(page);
        });
      });
      server.httpServer?.once("listening", () => {
        server.config.logger.info(`  mantaq viz: ${base}`);
      });
    },
  };
  const built = options.fuzz ?? {};
  const site = siteBuild({ base, patterns, fuzz: built, live, project, root: () => root });
  return [inspectEntry(), targets, site, plugin];
}
