/**
 * Browser entry for embedding the viewer in another page (e.g. the docs site).
 * Kept apart from the root entry so bundles skip the fuzzer and the AST
 * annotator (TypeScript compiler).
 */
import { parseAtlas } from "../validate.ts";
import type { AtlasIssue } from "../validate.ts";
import { html } from "./dom.ts";
import { mountViewer } from "./viewer.ts";
import type { ViewerOptions } from "./viewer.ts";
import { Either } from "@mantaq/utils";

export { mountViewer };
export type { ViewerOptions };

/** Replace `root` with a list of reasons `source` cannot be shown. */
export function showIssues(
  root: HTMLElement,
  context: { source: string; issues: AtlasIssue[] },
): void {
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

/** Validate atlas JSON text and mount it, or list what is wrong with it. */
export function mountAtlasText(
  root: HTMLElement,
  context: { source: string; text: string },
  options: ViewerOptions = {},
): void {
  const result = parseAtlas(context.text);
  if (Either.isLeft(result)) {
    showIssues(root, { source: context.source, issues: result[0] });
    return;
  }
  mountViewer(root, result[1], options);
}
