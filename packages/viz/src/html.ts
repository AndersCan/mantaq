function escapeText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Inline style text may not close its own element early. */
function inline(text: string): string {
  return text.replaceAll("</style", "<\\/style");
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
    `<style>${inline(parts.css)}</style>`,
    "</head>",
    '<body class="viz">',
    `<main id="app" data-src="${escapeText(parts.source)}"></main>`,
    `<script type="module" src="${escapeText(parts.entry)}"></script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
