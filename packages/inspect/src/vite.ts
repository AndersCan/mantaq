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
import { basename, dirname, isAbsolute, posix, resolve } from "node:path";
import {
  createProgramStore,
  forgetFile,
  forgetPrograms,
  hasProgram,
} from "./ast/programs/program-store.ts";
import { entryId, entryModuleId, inspectEntry, inspectFile, runOf } from "./load.ts";
import type { EnvironmentModuleNode, Plugin, ViteDevServer } from "vite";
import { existsSync, globSync, readFileSync } from "node:fs";
import type { FuzzSettings, InspectedModule } from "./inspect.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { livePageHtml, serializeViz, UPDATE_EVENT } from "@mantaq/viz";
import { normalizePath, searchForWorkspaceRoot } from "vite";
import { projectRoot, vizDocument } from "./inspect.ts";
import { analyzeModule } from "./ast/annotate.ts";
import { Either } from "@mantaq/utils";
import { fileURLToPath } from "node:url";
import type { LoadSourceOptions } from "./ast/program.ts";
import type { ProgramStore } from "./ast/programs/program-store.ts";

/** @deprecated No mantaq code imports this export; removed in a later release. */
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
function previewsOf(files: ReadonlyArray<string>, options: LoadSourceOptions): Map<string, string> {
  const previews = new Map<string, string>();
  for (const file of files) {
    const preview = previewFileOf(file);
    if (preview === undefined) continue;
    const analysis = analyzeModule({ file, root: projectRoot(file) }, options);
    if (Either.isLeft(analysis)) continue;
    for (const found of analysis[1].machines) previews.set(found.id, preview);
  }
  return previews;
}

/** Source of `virtual:mantaq/previews`: a lazy import of each preview file, by machine id. */
function previewsSource(files: ReadonlyArray<string>, options: LoadSourceOptions): string {
  const entries = [...previewsOf(files, options)].map(
    ([id, file]) => `  ${JSON.stringify(id)}: () => import(${JSON.stringify(file)}),`,
  );
  return ["export const previews = {", ...entries, "};"].join("\n");
}

/**
 * Source of `virtual:mantaq/targets`: one entry per `machine(...)` export.
 * The page owns the clock: it hands a VirtualClock to `create({ clock })`.
 */
export function targetsSource(
  files: ReadonlyArray<string>,
  options: LoadSourceOptions = {},
): string {
  const core = fileURLToPath(import.meta.resolve("@mantaq/core"));
  const imports: string[] = [];
  const entries: string[] = [];
  for (const [index, file] of files.entries()) {
    const analysis = analyzeModule({ file, root: projectRoot(file) }, options);
    if (Either.isLeft(analysis)) continue;
    const machines = analysis[1].machines;
    if (machines.length === 0) continue;
    imports.push(`import * as m${index} from ${JSON.stringify(file)};`);
    for (const found of machines) {
      entries.push(
        `  ${JSON.stringify(found.id)}: () => { const clock = VirtualClock(); const made = m${index}[${JSON.stringify(found.name)}].create({ clock }); const actor = ${found.unwrap === "actor" ? "made.actor" : "made"}; return { actor, clock, made }; },`,
      );
    }
  }
  return [
    `import { VirtualClock } from ${JSON.stringify(core)};`,
    ...imports,
    "export const targets = {",
    ...entries,
    "};",
    `export const previewed = ${JSON.stringify([...previewsOf(files, options).keys()])};`,
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

/** The programs one build or dev server shares; a build replaces them at its start. */
interface Shared {
  programs: ProgramStore;
}

/** One machine file inspected on the dev server, and the files its modules were loaded from. */
interface FileDocument {
  inspected: Promise<InspectedModule>;
  modules: ReadonlySet<string> | undefined;
}

interface DocumentContext {
  documents: Map<string, FileDocument>;
  files: ReadonlyArray<string>;
  fuzz: false | FuzzSettings;
  programs: ProgramStore;
}

interface DocumentFile extends DocumentContext {
  file: string;
}

interface MachineFile {
  file: string;
}

/** Files of the modules the entry of a machine file imports, followed to the end. */
function moduleFiles(server: ViteDevServer, options: MachineFile): Set<string> {
  const graph = server.environments.ssr.moduleGraph;
  const entry = graph.getModuleById(entryModuleId(options.file));
  const seen = new Set<EnvironmentModuleNode>();
  const pending = entry === undefined ? [] : [entry];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);
    pending.push(...node.importedModules);
  }
  return new Set([...seen].flatMap((node) => (node.file === null ? [] : [node.file])));
}

interface DevFile {
  file: string;
  fuzz: false | FuzzSettings;
  programs: ProgramStore;
}

async function inspectDevFile(server: ViteDevServer, options: DevFile): Promise<InspectedModule> {
  const { file, fuzz, programs } = options;
  const run = runOf(await server.ssrLoadModule(entryId(file)));
  return run === null
    ? { machines: [], warnings: [`${file}: could not load the inspector`] }
    : run({ fuzz, programs });
}

/** The document of the dev server for one file, inspected once and kept until a save touches it. */
function fileDocument(server: ViteDevServer, options: DocumentFile): Promise<InspectedModule> {
  const { documents, file } = options;
  const known = documents.get(file);
  if (known !== undefined) return known.inspected;
  const document: FileDocument = {
    inspected: inspectDevFile(server, { file, fuzz: options.fuzz, programs: options.programs }),
    modules: undefined,
  };
  documents.set(file, document);
  document.inspected.then(
    () => {
      document.modules = moduleFiles(server, { file });
    },
    () => {
      if (documents.get(file) === document) documents.delete(file);
    },
  );
  return document.inspected;
}

async function documentText(
  server: ViteDevServer,
  options: DocumentContext,
): Promise<{
  text: string;
  warnings: string[];
}> {
  const results = await Promise.all(
    options.files.map((file) => fileDocument(server, { ...options, file })),
  );
  return {
    text: serializeViz(vizDocument(results.flatMap((result) => result.machines))),
    warnings: results.flatMap((result) => result.warnings),
  };
}

interface Save {
  event: string;
  path: string;
  programs: ProgramStore;
}

interface SavedFile {
  path: string;
}

/** Whether the saved file is a recorded runs file, `<dir>/__runs__/<name>.json`, that `file` reads. */
function readsRuns(file: string, options: SavedFile): boolean {
  const { path } = options;
  return basename(dirname(path)) === "__runs__" && dirname(dirname(path)) === dirname(file);
}

/**
 * Forget what a save may have changed: the programs that read the file, and
 * the documents whose program or loaded modules read it. Adding or removing a
 * file can change what any import finds, so it forgets everything.
 */
function forgetSave(documents: Map<string, FileDocument>, save: Save): void {
  const { event, path, programs } = save;
  if (event !== "change") {
    forgetPrograms(programs);
    documents.clear();
    return;
  }
  forgetFile(programs, { path });
  for (const [file, document] of documents) {
    const stale =
      !hasProgram(programs, { file }) ||
      document.modules === undefined ||
      document.modules.has(path) ||
      readsRuns(file, { path });
    if (stale) documents.delete(file);
  }
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

interface SiteBuildContext {
  base: string;
  patterns: ReadonlyArray<string>;
  fuzz: false | FuzzSettings;
  live: string;
  project: { configFile: string | undefined };
  root: () => string;
  shared: Shared;
}

/** Build mode: write the page, `viz.json` and the viewer script under `base`. */
function siteBuild(context: SiteBuildContext): Plugin {
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
      context.shared.programs = createProgramStore();
      if (!standalone) this.emitFile({ type: "chunk", id: context.live, name: "mantaq-live" });
    },
    async generateBundle(_options, bundle) {
      const results = [];
      const options = { fuzz: context.fuzz, programs: context.shared.programs };
      const load = { config: context.project.configFile };
      for (const file of machineFiles(context.root(), context.patterns)) {
        const inspected = await inspectFile(file, options, load).then(
          (result) => Either.right(result),
          (error: unknown) => Either.left({ error }),
        );
        if (Either.isLeft(inspected)) {
          this.warn(`[mantaq-viz] ${file}: could not inspect (${String(inspected[0].error)})`);
          continue;
        }
        results.push(inspected[1]);
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

interface VirtualContext {
  files: () => ReadonlyArray<string>;
  shared: Shared;
}

function loadVirtual(id: string, context: VirtualContext): string | undefined {
  const { programs } = context.shared;
  if (id === TARGETS_RESOLVED) return targetsSource(context.files(), { programs });
  return id === PREVIEWS_RESOLVED ? previewsSource(context.files(), { programs }) : undefined;
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
  const shared: Shared = { programs: createProgramStore() };
  const targets: Plugin = {
    name: "mantaq-viz-targets",
    configResolved: (config) => {
      root = config.root;
      project.configFile = config.configFile;
    },
    resolveId: resolveVirtual,
    load: (id) => loadVirtual(id, { files: () => machineFiles(root, patterns), shared }),
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
      const documents = new Map<string, FileDocument>();
      async function build(): Promise<Built> {
        const files = machineFiles(server.config.root, patterns);
        const context = { documents, files, fuzz, programs: shared.programs };
        const { text, warnings } = await documentText(server, context);
        for (const warning of warnings) server.config.logger.warn(`[mantaq-viz] ${warning}`);
        return { text };
      }
      server.watcher.on("all", (event, path) => {
        if (!/\.[cm]?[jt]sx?$/.test(path) && !/[\\/]__runs__[\\/][^\\/]+\.json$/.test(path)) return;
        cached = null;
        forgetSave(documents, { event, path: normalizePath(path), programs: shared.programs });
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
  const site = siteBuild({ base, patterns, fuzz: built, live, project, root: () => root, shared });
  return [inspectEntry(), targets, site, plugin];
}
