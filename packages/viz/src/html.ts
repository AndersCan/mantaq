/** Element id the standalone page carries its document in (read by `mountEmbedded`). */
export const DOCUMENT_ELEMENT_ID = "mantaq-viz-document";

function escapeText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Inline script or style text may not close its own element early. */
function inline(text: string, tag: "script" | "style"): string {
  return text.replaceAll(`</${tag}`, `<\\/${tag}`);
}

/**
 * One HTML file that shows `document` with no server and no network: the
 * viewer bundle, its CSS and the document are all inlined.
 */
export function standaloneHtml(parts: {
  title: string;
  /** Built viewer bundle (classic script) whose entry is `viewer/standalone.ts`. */
  script: string;
  css: string;
  /** Serialized viz document. */
  document: string;
}): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeText(parts.title)}</title>`,
    `<style>${inline(parts.css, "style")}</style>`,
    "</head>",
    '<body class="viz">',
    '<main id="app"></main>',
    `<script type="application/json" id="${DOCUMENT_ELEMENT_ID}">${parts.document.replaceAll("<", "\\u003c")}</script>`,
    `<script>${inline(parts.script, "script")}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Custom HMR event `@mantaq/inspect/vite` sends after a machine file changes. */
export const UPDATE_EVENT = "mantaq:viz-update";

/** The live page: the viewer as a module, fetching the document from `source`. */
export function livePageHtml(parts: {
  title: string;
  source: string;
  entry: string;
  /** Stylesheet text, inlined: the built entry carries no CSS of its own. */
  css: string;
}): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeText(parts.title)}</title>`,
    `<style>${inline(parts.css, "style")}</style>`,
    "</head>",
    '<body class="viz">',
    `<main id="app" data-src="${escapeText(parts.source)}"></main>`,
    `<script type="module" src="${escapeText(parts.entry)}"></script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
