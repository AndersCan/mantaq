import { mountVizText, showIssues } from "./embed.ts";
import { linkOptions } from "./page.ts";
import "./page.css";

/** Written by `vp run viz:export`; used when no `?src=` is given. */
const DEFAULT_SRC = "examples/examples.json";

const params = new URLSearchParams(location.search);

async function loadUrl(root: HTMLElement, source: string): Promise<void> {
  const response = await fetch(source).catch(() => null);
  if (response === null || !response.ok) {
    const status = response === null ? "network error" : `HTTP ${response.status}`;
    showIssues(root, {
      source,
      issues: [{ path: "$", message: `${status}. Run \`vp run viz:export\` or pick a file.` }],
    });
    return;
  }
  mountVizText(root, { source, text: await response.text() }, linkOptions());
}

function wirePicker(picker: HTMLInputElement, root: HTMLElement): void {
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    void file.text().then((text) => mountVizText(root, { source: file.name, text }));
  });
}

const root = document.querySelector<HTMLElement>("#app");
const picker = document.querySelector<HTMLInputElement>("#file");
if (root && picker) {
  wirePicker(picker, root);
  void loadUrl(root, params.get("src") ?? DEFAULT_SRC);
}
