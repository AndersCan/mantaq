import { serializeViz, standaloneHtml } from "@mantaq/viz";
import type { VizDocument } from "@mantaq/viz";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { STYLESHEETS } from "./vite.ts";

/** The viewer as one classic script, built from `@mantaq/viz/standalone`. */
async function viewerScript(): Promise<string> {
  const entry = fileURLToPath(import.meta.resolve("@mantaq/viz/standalone"));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      cssCodeSplit: false,
      lib: { entry, formats: ["iife"], name: "MantaqViz", fileName: () => "viz.js" },
    },
  });
  const outputs = (Array.isArray(output) ? output : [output]).flatMap((each) =>
    "output" in each ? each.output : [],
  );
  return outputs.flatMap((file) => (file.type === "chunk" ? [file.code] : [])).join("\n");
}

/**
 * A self-contained HTML page for `document`: open it from disk, attach it, commit it.
 * With `live` (a built script that drives the machines), that script replaces the static viewer.
 */
export async function htmlPage(
  document: VizDocument,
  title: string,
  live?: string,
): Promise<string> {
  const css = STYLESHEETS.map((id) =>
    readFileSync(fileURLToPath(import.meta.resolve(id)), "utf8"),
  ).join("\n");
  const script = live ?? (await viewerScript());
  return standaloneHtml({ title, script, css, document: serializeViz(document) });
}
