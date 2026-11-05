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
import { vizDocument, machineId, projectRoot } from "./inspect.ts";
import { analyzeModule } from "./ast/annotate.ts";
import type { MachineExport } from "./ast/discover.ts";
import { entryId, inspectEntry, inspectFile, runOf } from "./load.ts";
import { Either } from "@mantaq/utils";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { searchForWorkspaceRoot } from "vite";
import type { Plugin, ViteDevServer } from "vite";

export const STYLESHEETS = ["@mantaq/viz/viewer.css", "@mantaq/viz/page.css"];

export interface MantaqVizOptions {
  /** Files that export machines: paths or globs, relative to the Vite root. */
  machines: string | string[];
  /** Where the page is served. Default `/__mantaq/`. */
  base?: string;
  /** `false` = structure only. Default: 500 iterations, so a save redraws quickly. */
  fuzz?: false | FuzzSettings;
}

const DEV_ITERATIONS = 500;

export const TARGETS = "virtual:mantaq/targets";
export const TARGETS_RESOLVED = `\0${TARGETS}`;

function createExpression(found: MachineExport, index: number): string {
  const callee = `m${index}[${JSON.stringify(found.name)}]`;
  const call =
    found.call === "clock"
      ? `${callee}(VirtualClock())`
      : found.call === "options"
        ? `${callee}({ clock: VirtualClock() })`
        : `${callee}()`;
  return found.unwrap === "actor" ? `${call}.actor` : call;
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
        `  ${JSON.stringify(machineId(found.name))}: () => { const actor = ${createExpression(found, index)}; return { actor, clock: actor.clock }; },`,
      );
    }
  });
  return [
    `import { VirtualClock } from ${JSON.stringify(core)};`,
    ...imports,
    "export const targets = {",
    ...entries,
    "};",
  ].join("\n");
}

function machineFiles(root: string, patterns: ReadonlyArray<string>): string[] {
  const files = patterns.flatMap((pattern) => globSync(pattern, { cwd: root }));
  return [...new Set(files.map((file) => (isAbsolute(file) ? file : resolve(root, file))))].sort();
}

async function documentText(
  server: ViteDevServer,
  context: { files: ReadonlyArray<string>; fuzz: false | FuzzSettings },
): Promise<{ text: string; warnings: string[] }> {
  const results = [];
  for (const file of context.files) {
    const run = runOf(await server.ssrLoadModule(entryId(file)));
    results.push(
      run === null
        ? { machines: [], warnings: [`${file}: could not load the inspector`] }
        : await run({ fuzz: context.fuzz }),
    );
  }
  return {
    text: serializeViz(vizDocument(results.flatMap((result) => result.machines))),
    warnings: results.flatMap((result) => result.warnings),
  };
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

export function mantaqViz(options: MantaqVizOptions): Plugin[] {
  const base = (options.base ?? "/__mantaq/").replace(/\/?$/, "/");
  const patterns = Array.isArray(options.machines) ? options.machines : [options.machines];
  const fuzz = options.fuzz ?? { iterations: DEV_ITERATIONS };
  const live = fileURLToPath(
    import.meta.resolve(import.meta.url.endsWith(".ts") ? "./live-entry.ts" : "./live-entry.mjs"),
  );
  const viz = dirname(dirname(fileURLToPath(import.meta.resolve("@mantaq/viz/live"))));
  let root = process.cwd();
  const project: { configFile: string | undefined } = { configFile: undefined };
  const targets: Plugin = {
    name: "mantaq-viz-targets",
    configResolved: (config) => {
      root = config.root;
      project.configFile = config.configFile;
    },
    resolveId: (id) => (id === TARGETS ? TARGETS_RESOLVED : null),
    load: (id) => (id === TARGETS_RESOLVED ? targetsSource(machineFiles(root, patterns)) : null),
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
            viz,
          ],
        },
      },
    }),
    configureServer(server) {
      let cached: Promise<string> | null = null;
      const build = async (): Promise<string> => {
        const files = machineFiles(server.config.root, patterns);
        const { text, warnings } = await documentText(server, { files, fuzz });
        for (const warning of warnings) server.config.logger.warn(`[mantaq-viz] ${warning}`);
        return text;
      };
      server.watcher.on("all", (_event, path) => {
        if (!/\.[cm]?[jt]sx?$/.test(path)) return;
        cached = null;
        const generated = server.moduleGraph.getModuleById(TARGETS_RESOLVED);
        if (generated !== undefined) server.moduleGraph.invalidateModule(generated);
        server.environments.ssr.moduleGraph.invalidateAll();
        server.ws.send({ type: "custom", event: UPDATE_EVENT });
      });
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0];
        if (path === `${base}viz.json`) {
          cached ??= build();
          cached.then(
            (text) => {
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
  const site = siteBuild({ base, patterns, fuzz, live, project, root: () => root });
  return [inspectEntry(), targets, site, plugin];
}
