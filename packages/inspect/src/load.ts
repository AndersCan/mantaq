import type { InspectedModule, ModuleOptions } from "./inspect.ts";
import { Either } from "@mantaq/utils";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfigFromFile, loadEnv, runnerImport } from "vite";
import type { InlineConfig, Plugin } from "vite";

/** Options `inspectFile` passes through to `inspectModule`; loading is its job. */
export type FileOptions = Omit<ModuleOptions, "load">;

/** Which Vite config and mode load the file; without a config, no project config is read. */
export interface LoadOptions {
  config?: string;
  mode?: string;
}

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

// Built in pieces so this file is not rewritten when it is itself loaded.
const ENV_ACCESS = ["import", "meta", "env"].join(".");

/**
 * Replaces the env object with the project's env: `runnerImport` never reads
 * env files, so `VITE_*` variables would otherwise be missing.
 */
function projectEnv(env: Record<string, string>, mode: string): Plugin {
  const value = JSON.stringify({
    ...env,
    BASE_URL: "/",
    MODE: mode,
    DEV: true,
    PROD: false,
    SSR: true,
  });
  return {
    name: "mantaq-inspect-env",
    enforce: "pre",
    transform: (code, id) =>
      id.includes("/node_modules/") || !code.includes(ENV_ACCESS)
        ? null
        : { code: code.replaceAll(ENV_ACCESS, `(${value})`), map: null },
  };
}

/**
 * The inline config for a load: empty without `--config`; otherwise the
 * project's Vite config (plugins, aliases, define) plus its env files.
 */
async function inlineConfig({ config, mode }: LoadOptions): Promise<InlineConfig> {
  const base: InlineConfig = { configFile: false, logLevel: "silent" };
  if (config === undefined) return { ...base, ...(mode === undefined ? {} : { mode }) };
  const chosen = mode ?? "development";
  const loaded = await loadConfigFromFile({ command: "serve", mode: chosen }, config);
  if (loaded === null) throw new Error(`cannot load Vite config ${config}`);
  const user = loaded.config;
  const envDir = resolve(dirname(config), user.envDir === false ? "." : (user.envDir ?? "."));
  const env = user.envDir === false ? {} : loadEnv(chosen, envDir, user.envPrefix ?? "VITE_");
  return {
    ...user,
    ...base,
    mode: chosen,
    plugins: [...(user.plugins ?? []), projectEnv(env, chosen)],
  };
}

/** Load `file` with Vite (TS, tsconfig paths, extensionless imports) and inspect its machines. */
export async function inspectFile(
  file: string,
  options: FileOptions = {},
  load: LoadOptions = {},
): Promise<InspectedModule> {
  const loaded = await inlineConfig(load)
    .then((inline) =>
      runnerImport(entryId(file), {
        ...inline,
        plugins: [...(inline.plugins ?? []), inspectEntry()],
      }),
    )
    .then(
      (value) => Either.right(value),
      (error: unknown) => Either.left(error instanceof Error ? error.message : String(error)),
    );
  if (Either.isLeft(loaded)) return { machines: [], warnings: [`${file}: ${loaded[0]}`] };
  const { module } = loaded[1];
  const run = runOf(module);
  if (run === null) return { machines: [], warnings: [`${file}: could not load the inspector`] };
  return run(options);
}
