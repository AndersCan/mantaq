// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { inspectModule, vizDocument } from "../index.ts";
import { grouped } from "../fixtures/grouped.ts";
import { join } from "node:path";
import { mountDriven } from "../live-page.ts";
import { serializeViz } from "@mantaq/viz";
import { VirtualClock } from "@mantaq/core";

const file = join(import.meta.dirname, "../fixtures/grouped.ts");

async function mount(): Promise<HTMLElement> {
  const loaded = Promise.resolve({ grouped });
  const inspected = await inspectModule(file, { load: () => loaded, fuzz: false });
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: serializeViz(vizDocument(inspected.machines)),
    targets: { grouped: () => ({ actor: grouped.create(), clock: VirtualClock() }) },
  });
  return root;
}

interface ArrowQuery {
  from: string;
  event: string;
}

/** Clicks the drawn arrow that leaves the drawn node `from` on `event`, as a person does. */
function clickArrow(root: HTMLElement, options: ArrowQuery): void {
  const arrows = root.querySelectorAll(`.graph g.edge[data-from="${options.from}"]`);
  const found = [...arrows].find(
    (each) => each.querySelector("text")?.textContent === options.event,
  );
  found?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Where the walk is, the drawn node marked current, and the drawn arrows a click sends now, as `from -event-> to`. */
function shown(root: HTMLElement) {
  const buttons: string[] = [];
  for (const edge of root.querySelectorAll('.graph g.edge[role="button"]')) {
    const event = edge.querySelector("text")?.textContent ?? "";
    const from = edge.getAttribute("data-from");
    const target = edge.getAttribute("data-to");
    buttons.push(`${from} -${event}-> ${target}`);
  }
  return {
    state: root.querySelector(".explore")?.getAttribute("data-current"),
    current: root.querySelector(".graph g.state.current")?.getAttribute("data-node-id"),
    buttons,
  };
}

describe("the grouped checkout, live", () => {
  test("the walk enters payment by an arrow, steps inside it and leaves it, every step a click on the folded diagram", async () => {
    const root = await mount();
    const seen = [shown(root)];
    clickArrow(root, { from: "inCart", event: "checkout" });
    seen.push(shown(root));
    clickArrow(root, { from: "@payment", event: "charged" });
    seen.push(shown(root));
    clickArrow(root, { from: "@payment", event: "confirmed" });
    seen.push(shown(root));
    expect(seen).toEqual([
      { state: "inCart", current: "inCart", buttons: ["inCart -checkout-> @payment"] },
      { state: "chargingCard", current: "@payment", buttons: ["@payment -charged-> @payment"] },
      { state: "confirming", current: "@payment", buttons: ["@payment -confirmed-> @shipping"] },
      { state: "packing", current: "@shipping", buttons: ["@shipping -packed-> @shipping"] },
    ]);
  });
});
