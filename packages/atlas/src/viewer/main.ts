import { parseAtlas } from "../validate.ts";
import type { AtlasIssue } from "../validate.ts";
import { html } from "./dom.ts";
import { mountViewer } from "./viewer.ts";
import { Either } from "@mantaq/utils";

/** Written by `vp run atlas:export`; used when no `?src=` is given. */
const DEFAULT_SRC = "atlas/examples.json";

function showIssues(root: HTMLElement, context: { source: string; issues: AtlasIssue[] }): void {
  const doc = root.ownerDocument;
  root.replaceChildren(
    html(doc, "section", { class: "load-error", role: "alert" }, [
      html(doc, "h2", {}, [`Cannot show ${context.source}`]),
      html(
        doc,
        "ul",
        {},
        context.issues.map((issue) => html(doc, "li", {}, [`${issue.path}: ${issue.message}`])),
      ),
    ]),
  );
}

function show(root: HTMLElement, context: { source: string; text: string }): void {
  const result = parseAtlas(context.text);
  if (Either.isLeft(result)) {
    showIssues(root, { source: context.source, issues: result[0] });
    return;
  }
  mountViewer(root, result[1]);
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
  show(root, { source, text: await response.text() });
}

function wirePicker(picker: HTMLInputElement, root: HTMLElement): void {
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    void file.text().then((text) => show(root, { source: file.name, text }));
  });
}

const root = document.querySelector<HTMLElement>("#app");
const picker = document.querySelector<HTMLInputElement>("#file");
if (root && picker) {
  wirePicker(picker, root);
  void loadUrl(root, new URLSearchParams(location.search).get("src") ?? DEFAULT_SRC);
}
