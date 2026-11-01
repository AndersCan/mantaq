import { serializeViz, standaloneHtml } from "@mantaq/viz";
import type { VizDocument } from "@mantaq/viz";
import { fileURLToPath } from "node:url";
import { build } from "vite";

/** The viewer as one classic script plus its CSS, built from `@mantaq/viz/standalone`. */
async function viewerBundle(): Promise<{ script: string; css: string }> {
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
  const script = outputs.flatMap((file) => (file.type === "chunk" ? [file.code] : [])).join("\n");
  const css = outputs
    .flatMap((file) =>
      file.type === "asset" && file.fileName.endsWith(".css") ? [String(file.source)] : [],
    )
    .join("\n");
  return { script, css };
}

/** A self-contained HTML page for `document`: open it from disk, attach it, commit it. */
export async function htmlPage(document: VizDocument, title: string): Promise<string> {
  const bundle = await viewerBundle();
  return standaloneHtml({ title, ...bundle, document: serializeViz(document) });
}
