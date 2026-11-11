import { html } from "./dom.ts";

/** One line of small text items under a diagram; null when there is nothing to say. */
export function keyLine(doc: Document, items: ReadonlyArray<string>): HTMLElement | null {
  if (items.length === 0) return null;
  return html(doc, "p", { class: "viz-key", "data-viz-key": "" }, [items.join("   ")]);
}
