import { fileURLToPath } from "node:url";
import { build } from "vite";
import { inlineConfig } from "./load.ts";
import type { LoadOptions } from "./load.ts";
import { TARGETS, TARGETS_RESOLVED, targetsSource } from "./vite.ts";
import type { Plugin } from "vite";

/**
 * The live page as one classic script: the viewer, the driver and every
 * exported factory of `files`, built with the project's Vite config.
 */
export async function liveBundle(files: ReadonlyArray<string>, load: LoadOptions): Promise<string> {
  const entry = fileURLToPath(
    import.meta.resolve(
      import.meta.url.endsWith(".ts") ? "./live-embedded.ts" : "./live-embedded.mjs",
    ),
  );
  const targets: Plugin = {
    name: "mantaq-live-targets",
    resolveId: (id) => (id === TARGETS ? TARGETS_RESOLVED : null),
    load: (id) => (id === TARGETS_RESOLVED ? targetsSource(files) : null),
  };
  const inline = await inlineConfig(load);
  const output = await build({
    ...inline,
    logLevel: "silent",
    plugins: [...(inline.plugins ?? []), targets],
    build: {
      write: false,
      minify: true,
      cssCodeSplit: false,
      lib: { entry, formats: ["iife"], name: "MantaqLive", fileName: () => "live.js" },
    },
  });
  const outputs = (Array.isArray(output) ? output : [output]).flatMap((each) =>
    "output" in each ? each.output : [],
  );
  return outputs.flatMap((file) => (file.type === "chunk" ? [file.code] : [])).join("\n");
}
