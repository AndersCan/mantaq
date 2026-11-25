// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { inspectModule, vizDocument } from "../index.ts";
import { groupedBoard } from "../fixtures/grouped-board.ts";
import { join } from "node:path";
import { mountDriven } from "../live-page.ts";
import { serializeViz } from "@mantaq/viz";
import { VirtualClock } from "@mantaq/core";

const file = join(import.meta.dirname, "../fixtures/grouped-board.ts");

async function mount(): Promise<HTMLElement> {
  const loaded = Promise.resolve({ groupedBoard });
  const inspected = await inspectModule(file, { load: () => loaded, fuzz: false });
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: serializeViz(vizDocument(inspected.machines)),
    targets: {
      groupedBoard: () => {
        const clock = VirtualClock();
        const made = groupedBoard.create({ clock });
        return { actor: made.actor, clock, made };
      },
    },
  });
  return root;
}

function press(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function escape(element: Element | null | undefined): void {
  element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

interface ArrowQuery {
  from: string;
  event: string;
}

/** Clicks the drawn arrow that leaves the drawn node `from` on `event`, as a person does. */
function clickArrow(root: HTMLElement, options: ArrowQuery): void {
  const arrows = root.querySelectorAll(`.graph g.edge[data-from="${options.from}"]`);
  press([...arrows].find((each) => each.querySelector("text")?.textContent === options.event));
}

/** The path above the canvas, the drawn nodes, which of them is current, and where focus is. */
function shown(root: HTMLElement) {
  const path: string[] = [];
  for (const crumb of root.querySelectorAll(".focus-path li > *")) path.push(crumb.textContent);
  const nodes: string[] = [];
  for (const node of root.querySelectorAll(".graph g.state[data-node-id]")) {
    nodes.push(node.getAttribute("data-node-id") ?? "");
  }
  const focused = root.ownerDocument.activeElement;
  return {
    path,
    nodes,
    current: root.querySelector(".graph g.state.current")?.getAttribute("data-node-id"),
    focused:
      focused?.getAttribute("data-enter-group") ?? focused?.getAttribute("data-part") ?? undefined,
  };
}

describe("a group inside a machine of a board, live", () => {
  test("is entered from its machine, walked inside, and left with Escape", async () => {
    const root = await mount();
    press(root.querySelector('.graph g.part[data-part="till"]'));
    press(root.querySelector('.machine-enter[data-enter-group="till.@payment"]'));
    const entered = shown(root);
    clickArrow(root, { from: "till.open", event: "pay" });
    clickArrow(root, { from: "till.chargingCard", event: "charged" });
    const walked = shown(root);
    escape(root.querySelector(".panel"));
    const left = shown(root);
    escape(root.querySelector(".panel"));
    expect({ entered, walked, left, board: shown(root) }).toStrictEqual({
      entered: {
        path: ["groupedBoard", "till", "payment"],
        nodes: ["till.chargingCard", "till.confirming", "till.open", "till.paid"],
        current: "till.open",
        focused: undefined,
      },
      walked: {
        path: ["groupedBoard", "till", "payment"],
        nodes: ["till.chargingCard", "till.confirming", "till.open", "till.paid"],
        current: "till.confirming",
        focused: undefined,
      },
      left: {
        path: ["groupedBoard", "till"],
        nodes: ["till.@payment", "till.open", "till.paid"],
        current: "till.@payment",
        focused: "till.@payment",
      },
      board: { path: [], nodes: [], current: undefined, focused: "till" },
    });
  });
});
