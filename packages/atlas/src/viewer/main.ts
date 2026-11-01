import { mountAtlasText, showIssues } from "./embed.ts";
import type { ViewerOptions } from "./embed.ts";

/** Written by `vp run atlas:export`; used when no `?src=` is given. */
const DEFAULT_SRC = "atlas/examples.json";

const params = new URLSearchParams(location.search);

/** `?machine=checkout&journey=card-declined` opens straight into that walk. */
function linkOptions(): ViewerOptions {
  const machine = params.get("machine");
  const journey = params.get("journey");
  return {
    ...(machine === null ? {} : { machine }),
    ...(journey === null ? {} : { journey }),
  };
}

async function loadUrl(root: HTMLElement, source: string): Promise<void> {
  const response = await fetch(source).catch(() => null);
  if (response === null || !response.ok) {
    const status = response === null ? "network error" : `HTTP ${response.status}`;
    showIssues(root, {
      source,
      issues: [{ path: "$", message: `${status}. Run \`vp run atlas:export\` or pick a file.` }],
    });
    return;
  }
  mountAtlasText(root, { source, text: await response.text() }, linkOptions());
}

function wirePicker(picker: HTMLInputElement, root: HTMLElement): void {
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    void file.text().then((text) => mountAtlasText(root, { source: file.name, text }));
  });
}

const root = document.querySelector<HTMLElement>("#app");
const picker = document.querySelector<HTMLInputElement>("#file");
if (root && picker) {
  wirePicker(picker, root);
  void loadUrl(root, params.get("src") ?? DEFAULT_SRC);
}
