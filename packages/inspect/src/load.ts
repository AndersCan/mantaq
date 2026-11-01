import type { InspectedModule, ModuleOptions } from "./inspect.ts";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import type { Plugin } from "vite";

/** Options `inspectFile` passes through to `inspectModule`; loading is its job. */
export type FileOptions = Omit<ModuleOptions, "load">;

const ENTRY = "virtual:mantaq-inspect";
const RESOLVED = `\0${ENTRY}`;

/**
 * A module that imports the machine file and the inspector side by side. Run
 * through one module graph, both see the same `@mantaq/core` instance: core
 * recognizes its state refs by a module-level registry, so a machine loaded
 * through a bundler and inspected from plain Node would look stateless.
 */
function entrySource(file: string): string {
  const inspect = fileURLToPath(import.meta.resolve("@mantaq/inspect"));
  return [
    `import * as machines from ${JSON.stringify(file)};`,
    `import { inspectModule } from ${JSON.stringify(inspect)};`,
    `export function run(options) {`,
    `  return inspectModule(${JSON.stringify(file)}, { ...options, load: async () => machines });`,
    `}`,
  ].join("\n");
}

/** Vite plugin serving the entry for each `virtual:mantaq-inspect?file=<path>` id. */
export function inspectEntry(): Plugin {
  return {
    name: "mantaq-inspect-entry",
    resolveId: (id) => (id.startsWith(ENTRY) ? `\0${id}` : null),
    load: (id) => {
      if (!id.startsWith(RESOLVED)) return null;
      const file = new URLSearchParams(id.slice(id.indexOf("?") + 1)).get("file");
      return file === null ? null : entrySource(file);
    },
  };
}

export function entryId(file: string): string {
  return `${ENTRY}?${new URLSearchParams({ file }).toString()}`;
}

/** The `run` export of an entry module, checked: module objects are untyped. */
export function runOf(
  module: unknown,
): ((options: FileOptions) => Promise<InspectedModule>) | null {
  const run: unknown =
    typeof module === "object" && module !== null ? Reflect.get(module, "run") : undefined;
  if (typeof run !== "function") return null;
  return async (options) => Reflect.apply(run, undefined, [options]);
}

/** Load `file` with Vite (TS, tsconfig paths, extensionless imports) and inspect its machines. */
export async function inspectFile(
  file: string,
  options: FileOptions = {},
): Promise<InspectedModule> {
  const { module } = await runnerImport(entryId(file), {
    configFile: false,
    logLevel: "silent",
    plugins: [inspectEntry()],
  });
  const run = runOf(module);
  if (run === null) return { machines: [], warnings: [`${file}: could not load the inspector`] };
  return run(options);
}
