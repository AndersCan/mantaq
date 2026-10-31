import { mountAtlasText, showIssues } from "./embed.ts";

/** Written by `vp run atlas:export`; used when no `?src=` is given. */
const DEFAULT_SRC = "atlas/examples.json";

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
  mountAtlasText(root, { source, text: await response.text() });
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
  void loadUrl(root, new URLSearchParams(location.search).get("src") ?? DEFAULT_SRC);
}
