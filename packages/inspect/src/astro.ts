/**
 * Astro integration: publish machine pages from `.astro` files.
 *
 *   // astro.config.mjs
 *   import { mantaqViz } from "@mantaq/inspect/astro";
 *   export default defineConfig({ integrations: [mantaqViz({ machines: ["src/x.ts"] })] });
 *
 *   ---
 *   import Machine from "@mantaq/inspect/astro/Machine.astro";
 *   ---
 *   <Machine src="src/x.ts" />
 *
 * Throwing in the hook and in the component frontmatter is Astro's failure
 * channel: it stops the build and prints the message.
 */
import { machineFindings, serializeViz } from "@mantaq/viz";
import type { VizMachine } from "@mantaq/viz";
import type { AstroIntegration } from "astro";
import type { Plugin } from "vite";
import { vizDocument } from "./inspect.ts";
import type { FuzzSettings } from "./inspect.ts";
import { layoutOverview, machineLinks } from "./astro/overview.ts";
import { findingLines } from "./gate.ts";
import { inspectEntry, inspectFile } from "./load.ts";
import { TARGETS, TARGETS_RESOLVED, targetsSource } from "./vite.ts";
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface MantaqAstroOptions {
  /** Machine files, relative to the Astro root or absolute. Paths, not globs. */
  machines: string[];
  /** `false` = structure only. Default: inspect's default run (seeded, 2000 iterations). */
  fuzz?: false | FuzzSettings;
  /**
   * `astro build` fails when any machine has a design finding, could not be
   * fuzzed (unless `fuzz: false`), or has an expectation that is not checked.
   * The error lists each with the events that lead there. `astro dev` only
   * shows them on the page. Default false.
   */
  failOnFindings?: boolean;
}

const DOCUMENTS = "virtual:mantaq/documents";
const DOCUMENTS_RESOLVED = `\0${DOCUMENTS}`;
const CLIENT = "virtual:mantaq/astro-client";

const NOT_FUZZED = /^[^:]*: not fuzzed: /;

function failureReport(
  fuzzed: boolean,
  files: ReadonlyArray<{ rel: string; machines: VizMachine[]; warnings: string[] }>,
): string {
  const blocks: string[] = [];
  let count = 0;
  for (const { rel, machines, warnings } of files) {
    for (const machine of machines) {
      const items = findingLines(machine);
      if (fuzzed && machine.fuzz === null) {
        const reason = warnings.find((w) => NOT_FUZZED.test(w))?.replace(NOT_FUZZED, "");
        items.push(
          `  - not fuzzed: ${reason ?? "no fuzz run"}; handler throws, never-see and must-see cannot be found. Export a factory on a VirtualClock, or pass fuzz: false to mantaqViz`,
        );
      }
      if (items.length === 0) continue;
      count += items.filter((line) => line.startsWith("  - ")).length;
      blocks.push(`${machine.id} in ${rel}:`, ...items);
    }
    const expectations = warnings.filter((w) => /\bexpectations\b/i.test(w));
    if (expectations.length > 0) {
      count += expectations.length;
      blocks.push(`${rel}:`, ...expectations.map((w) => `  - ${w}`));
    }
  }
  if (count === 0) return "";
  const head = `[mantaq-viz] failOnFindings: ${count} ${count === 1 ? "problem stops" : "problems stop"} the build`;
  return [head, ...blocks].join("\n");
}

async function documentsSource(
  context: {
    root: string;
    files: ReadonlyArray<string>;
    fuzz: false | FuzzSettings;
    failOnFindings?: boolean;
  },
  plugin: { warn: (message: string) => void; error: (message: string) => never },
): Promise<string> {
  const documents: Record<string, unknown> = {};
  const owners = new Map<string, string>();
  const all: Array<{ file: string; machine: VizMachine }> = [];
  const reported: Array<{ rel: string; machines: VizMachine[]; warnings: string[] }> = [];
  for (const file of context.files) {
    const loaded = await inspectFile(file, { fuzz: context.fuzz });
    if (loaded.failed) {
      plugin.error(`[mantaq-viz] ${file}: could not load: ${loaded.warnings.join("; ")}`);
    }
    reported.push({
      rel: relative(context.root, file).split(sep).join("/"),
      machines: loaded.machines,
      warnings: loaded.warnings,
    });
    for (const warning of loaded.warnings) plugin.warn(`[mantaq-viz] ${warning}`);
    for (const machine of loaded.machines) {
      const other = owners.get(machine.id);
      if (other !== undefined) {
        plugin.error(
          `[mantaq-viz] machine id ${machine.id} comes from both ${other} and ${file}; rename one export (the live panel looks factories up by id)`,
        );
      }
      owners.set(machine.id, file);
      all.push({ file, machine });
    }
    documents[file] = {
      text: serializeViz(vizDocument(loaded.machines)),
      machines: loaded.machines.map((machine) => machine.id),
      findings: loaded.machines.flatMap((machine) =>
        machineFindings(machine).map((f) => ({
          machine: machine.id,
          kind: f.kind,
          state: f.state,
          message: f.message,
        })),
      ),
      fuzzed: context.fuzz !== false,
    };
  }
  if (context.failOnFindings === true) {
    const report = failureReport(context.fuzz !== false, reported);
    if (report !== "") plugin.error(report);
  }
  return [
    `export const root = ${JSON.stringify(context.root)};`,
    `export const documents = ${JSON.stringify(documents)};`,
    `export const overview = ${JSON.stringify(
      layoutOverview(
        all.map(({ file, machine }) => ({ id: machine.id, file })),
        machineLinks(all),
      ),
    )};`,
  ].join("\n");
}

export function astroMachines(context: {
  root: string;
  files: ReadonlyArray<string>;
  fuzz: false | FuzzSettings;
  failOnFindings?: boolean;
}): Plugin {
  const client = fileURLToPath(
    import.meta.resolve(
      import.meta.url.endsWith(".ts") ? "./astro/client.ts" : "./astro-client.mjs",
    ),
  );
  let documents: Promise<string> | null = null;
  return {
    name: "mantaq-viz-astro",
    resolveId(id) {
      if (id === DOCUMENTS) return DOCUMENTS_RESOLVED;
      if (id === TARGETS) return TARGETS_RESOLVED;
      if (id === CLIENT) return client;
      return null;
    },
    handleHotUpdate({ file, server }) {
      if (!context.files.includes(file)) return;
      documents = null;
      const module = server.moduleGraph.getModuleById(DOCUMENTS_RESOLVED);
      if (module !== undefined) server.moduleGraph.invalidateModule(module);
    },
    load(id) {
      if (id === TARGETS_RESOLVED) return targetsSource(context.files);
      if (id !== DOCUMENTS_RESOLVED) return null;
      documents ??= documentsSource(context, {
        warn: (message) => this.warn(message),
        error: (message) => this.error(message),
      });
      return documents;
    },
  };
}

export function mantaqViz(options: MantaqAstroOptions): AstroIntegration {
  return {
    name: "@mantaq/inspect/astro",
    hooks: {
      "astro:config:setup": ({ command, config, updateConfig }) => {
        const root = fileURLToPath(config.root);
        if (options.machines.length === 0) {
          throw new Error("mantaqViz: machines is empty; list the machine files to draw");
        }
        const files = options.machines.map((file) => resolve(root, file));
        options.machines.forEach((given, index) => {
          const abs = files[index] ?? given;
          if (!existsSync(abs)) {
            throw new Error(
              `mantaqViz: machine file not found: ${given} (resolved to ${abs}). machines takes file paths, not globs.`,
            );
          }
        });
        updateConfig({
          vite: {
            plugins: [
              inspectEntry(),
              astroMachines({
                root,
                files,
                fuzz: options.fuzz ?? {},
                failOnFindings: options.failOnFindings === true && command === "build",
              }),
            ],
          },
        });
      },
    },
  };
}
