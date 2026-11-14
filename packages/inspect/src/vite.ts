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
import type { VizMachine } from "@mantaq/viz";
import type { FuzzSettings } from "./inspect.ts";
import { vizDocument, machineId, projectRoot } from "./inspect.ts";
import { analyzeModule } from "./ast/annotate.ts";
import type { MachineExport } from "./ast/discover.ts";
import { entryId, inspectEntry, inspectFile, runOf } from "./load.ts";
import { Either } from "@mantaq/utils";
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_BODY_BYTES, answerNotes } from "./notes-server.ts";
import type { NotesContext } from "./notes-server.ts";
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
    for (const found of analysis[1].machines.filter((each) => each.call !== "instance")) {
      previews.set(machineId(found.name), preview);
    }
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

function createExpression(found: MachineExport, index: number): string {
  const callee = `m${index}[${JSON.stringify(found.name)}]`;
  const call =
    found.call === "clock"
      ? `${callee}(VirtualClock())`
      : found.call === "options"
        ? `${callee}({ clock: VirtualClock() })`
        : `${callee}()`;
  return call;
}

/**
 * Source of `virtual:mantaq/targets`: one factory per exported actor factory,
 * shaped by its type (`call`, `clock`, `options`). A bare actor export cannot
 * be recreated, so it gets none. Like the server-side inspection, plain actors
 * are skipped when a file has factories.
 */
export function targetsSource(files: ReadonlyArray<string>): string {
  const core = fileURLToPath(import.meta.resolve("@mantaq/core"));
  const imports: string[] = [];
  const entries: string[] = [];
  files.forEach((file, index) => {
    const analysis = analyzeModule({ file, root: projectRoot(file) });
    if (Either.isLeft(analysis)) return;
    const factories = analysis[1].machines.filter((found) => found.call !== "instance");
    if (factories.length === 0) return;
    imports.push(`import * as m${index} from ${JSON.stringify(file)};`);
    for (const found of factories) {
      entries.push(
        `  ${JSON.stringify(machineId(found.name))}: () => { const made = ${createExpression(found, index)}; const actor = ${found.unwrap === "actor" ? "made.actor" : "made"}; return { actor, clock: actor.clock, made }; },`,
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
  owners: Map<string, { file: string; machine: VizMachine }>;
}

async function documentText(
  server: ViteDevServer,
  context: { files: ReadonlyArray<string>; fuzz: false | FuzzSettings },
): Promise<{
  text: string;
  warnings: string[];
  owners: Map<string, { file: string; machine: VizMachine }>;
}> {
  const results = [];
  const owners = new Map<string, { file: string; machine: VizMachine }>();
  for (const file of context.files) {
    const run = runOf(await server.ssrLoadModule(entryId(file)));
    const result =
      run === null
        ? { machines: [], warnings: [`${file}: could not load the inspector`] }
        : await run({ fuzz: context.fuzz });
    for (const machine of result.machines) {
      if (!owners.has(machine.id)) owners.set(machine.id, { file, machine });
    }
    results.push(result);
  }
  return {
    owners,
    text: serializeViz(vizDocument(results.flatMap((result) => result.machines))),
    warnings: results.flatMap((result) => result.warnings),
  };
}

function errorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : String(error);
}

/** The request body as text, or `undefined` once it passes the byte limit. */
function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) done(undefined);
      else chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => done(undefined));
  });
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function notesFiles(written: Map<string, string>): NotesContext["files"] {
  return {
    read: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    write: (path, text) => {
      try {
        writeFileSync(path, text);
        written.set(path, text);
        return Either.right();
      } catch (error) {
        return Either.left(errorMessage(error));
      }
    },
  };
}

function serveNotes(
  http: { request: IncomingMessage; response: ServerResponse },
  notes: { search: string; context: NotesContext },
): void {
  const { request, response } = http;
  void readBody(request).then(async (body) => {
    const answer =
      body === undefined
        ? { status: 413, body: { error: "the note is longer than 2000 characters" } }
        : await answerNotes(
            {
              method: request.method ?? "GET",
              query: new URLSearchParams(notes.search),
              headers: {
                host: header(request.headers.host),
                origin: header(request.headers.origin),
                contentType: header(request.headers["content-type"]),
                secFetchSite: header(request.headers["sec-fetch-site"]),
              },
              remote: request.socket.remoteAddress,
              body,
            },
            notes.context,
          );
    response.statusCode = answer.status;
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify(answer.body));
  });
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
      const written = new Map<string, string>();
      const build = async (): Promise<Built> => {
        const files = machineFiles(server.config.root, patterns);
        const { text, warnings, owners } = await documentText(server, { files, fuzz });
        for (const warning of warnings) server.config.logger.warn(`[mantaq-viz] ${warning}`);
        return { text, owners };
      };
      const notesContext: NotesContext = {
        root: server.config.root,
        owner: async (machine) => {
          cached ??= build();
          try {
            const found = (await cached).owners.get(machine);
            return found === undefined ? Either.left("unknown" as const) : Either.right(found);
          } catch {
            cached = null;
            return Either.left("load" as const);
          }
        },
        files: notesFiles(written),
      };
      server.watcher.on("all", (_event, path) => {
        if (path.endsWith(".notes.md")) {
          // Machines did not change: tell the page, keep the cache. Skip the page's own write.
          try {
            if (readFileSync(path, "utf8") === written.get(path)) return;
          } catch {
            // unreadable: let the page look again
          }
          server.ws.send({ type: "custom", event: UPDATE_EVENT });
          return;
        }
        if (!/\.[cm]?[jt]sx?$/.test(path) && !/[\\/]__runs__[\\/][^\\/]+\.json$/.test(path)) return;
        cached = null;
        invalidateVirtual(server);
        server.environments.ssr.moduleGraph.invalidateAll();
        server.ws.send({ type: "custom", event: UPDATE_EVENT });
      });
      server.middlewares.use((request, response, next) => {
        const [path, search] = (request.url ?? "").split("?");
        if (path === `${base}notes`) {
          serveNotes({ request, response }, { search: search ?? "", context: notesContext });
          return;
        }
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
