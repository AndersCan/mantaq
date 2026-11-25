// @vitest-environment happy-dom
import { affordance, svg } from "./dom.ts";
import { expect, test } from "vite-plus/test";

const WATCHED = ["role", "aria-current"];

/** The CSS hides an `edge-help` that is neither a button nor the current choice, and a hidden element loses focus. */
function isHidden(values: ReadonlyMap<string, string | undefined>): boolean {
  return values.get("role") !== "button" && values.get("aria-current") !== "true";
}

/** The value an attribute took at a change: the old value of its next change, else its value now. */
function valueAfter(element: Element, changes: ReadonlyArray<MutationRecord>): string | undefined {
  const [next] = changes;
  if (next === undefined) return undefined;
  for (const later of changes.slice(1)) {
    if (later.attributeName === next.attributeName) return later.oldValue ?? undefined;
  }
  return element.getAttribute(next.attributeName ?? "") ?? undefined;
}

/** Replays each attribute change in order and says, after each one, whether the CSS would hide the element. */
function hiddenAfterEachChange(
  element: Element,
  changes: ReadonlyArray<MutationRecord>,
): boolean[] {
  const values = new Map<string, string | undefined>();
  for (const name of WATCHED) values.set(name, element.getAttribute(name) ?? undefined);
  for (const change of [...changes].reverse()) {
    values.set(change.attributeName ?? "", change.oldValue ?? undefined);
  }
  const hidden: boolean[] = [];
  for (const [index, change] of changes.entries()) {
    values.set(change.attributeName ?? "", valueAfter(element, changes.slice(index)));
    hidden.push(isHidden(values));
  }
  return hidden;
}

test("a ? that becomes the current choice is never hidden on the way, so it keeps focus", () => {
  const help = svg(document, "g", { class: "edge-help" });
  document.body.append(svg(document, "svg", {}, [help]));
  affordance(help, "button");
  const observer = new MutationObserver(() => undefined);
  observer.observe(help, { attributes: true, attributeOldValue: true, attributeFilter: WATCHED });
  affordance(help, "current");
  expect(hiddenAfterEachChange(help, observer.takeRecords())).toEqual([false, false]);
});
