import { serializeViz, standaloneHtml } from "@mantaq/viz";
import type { VizDocument } from "@mantaq/viz";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";

/** The viewer as one classic script, built from `@mantaq/viz/standalone`, plus its stylesheets. */
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
  const css = ["@mantaq/viz/viewer.css", "@mantaq/viz/page.css"]
    .map((id) => readFileSync(fileURLToPath(import.meta.resolve(id)), "utf8"))
    .join("\n");
  return { script, css };
}

/** A self-contained HTML page for `document`: open it from disk, attach it, commit it. */
export async function htmlPage(document: VizDocument, title: string): Promise<string> {
  const bundle = await viewerBundle();
  return standaloneHtml({ title, ...bundle, document: serializeViz(document) });
}
