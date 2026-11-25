// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { VizDriver, VizLiveEmbed, VizLiveState, VizStep } from "../../../schema.ts";
import { documentOf } from "../../../validate/embed-document.ts";
import { mountViewer } from "../../embed.ts";

const shop = documentOf([
  {
    id: "checkout",
    states: [
      { id: "cart", role: "initial" },
      { id: "paying", machine: "payment", forward: ["submit"] },
      { id: "done", role: "final" },
    ],
    edges: [
      { from: "cart", event: "pay", to: "paying" },
      { from: "paying", event: "paid", to: "done" },
    ],
  },
  {
    id: "payment",
    states: [
      { id: "card", role: "initial" },
      { id: "verifying" },
      { id: "settled", role: "final" },
    ],
    edges: [
      { from: "card", event: "submit", to: "verifying" },
      { from: "verifying", event: "approve", to: "settled" },
    ],
  },
]);

interface DriverOptions {
  /** Where checkout starts: cart, or already paying. */
  start: string;
}

/** Checkout runs payment while it is in paying, and forwards submit to it. */
function checkoutDriver(options: DriverOptions): VizDriver & { taken: VizStep[] } {
  const taken: VizStep[] = [];
  let steps: VizStep[] = [];
  let state = options.start;
  let payment = "card";
  function embeds(): VizLiveEmbed[] {
    if (state !== "paying") return [];
    return [{ state: "paying", current: payment }];
  }
  function liveNow(): VizLiveState {
    return {
      state,
      steps: [...steps],
      last: null,
      after: [],
      timers: [],
      context: {},
      payload: null,
      regions: {},
      children: [],
      effectMode: "held",
      waiting: [],
      embeds: embeds(),
    };
  }
  return {
    taken,
    reset: () => {
      steps = [];
      state = options.start;
      payment = "card";
      return liveNow();
    },
    step: (step) => {
      taken.push(step);
      const event = step.kind === "event" ? step.event : "";
      const submitted = state === "paying" && event === "submit" && payment === "card";
      if (state === "cart" && event === "pay") state = "paying";
      else if (submitted) payment = "verifying";
      steps = [...steps, step];
      return liveNow();
    },
    listen: () => undefined,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

interface MountOptions {
  steps: string[];
  start?: string;
}

function mountEntered(options: MountOptions): {
  root: HTMLElement;
  driver: ReturnType<typeof checkoutDriver>;
} {
  const root = document.createElement("div");
  document.body.append(root);
  const driver = checkoutDriver({ start: options.start ?? "cart" });
  mountViewer(root, shop, { driver, steps: options.steps, focus: ["paying"] });
  return { root, driver };
}

function press(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

interface ArrowOptions {
  id: string;
}

function arrow(root: HTMLElement, options: ArrowOptions): Element | undefined {
  return root.querySelector(`.canvas g.edge[data-edge-id="${options.id}"]`) ?? undefined;
}

/** What the entered machine shows of the walk. */
function walkShown(root: HTMLElement) {
  return {
    current: root.querySelector(".canvas g.state.current")?.getAttribute("data-node-id"),
    note: root.querySelector("[data-entered-note]")?.textContent,
    empty: root.querySelector("[data-live-empty]")?.textContent,
  };
}

describe("an entered machine while the root runs it", () => {
  test("marks the child's state, and a click on a forwarded arrow is a step of the root", () => {
    const { root, driver } = mountEntered({ steps: ["pay"] });
    const before = walkShown(root);
    press(arrow(root, { id: "card-submit-verifying" }));
    expect({
      before,
      after: walkShown(root).current,
      taken: driver.taken.slice(1),
      steps: root.querySelectorAll("ol.explore-run > li").length,
    }).toStrictEqual({
      before: { current: "card", note: undefined, empty: undefined },
      after: "verifying",
      taken: [{ kind: "event", event: "submit", payload: null }],
      steps: 2,
    });
  });

  test("before the first step, the Step tab says which arrows send", () => {
    const { root } = mountEntered({ steps: [], start: "paying" });
    expect(walkShown(root)).toStrictEqual({
      current: "card",
      note: undefined,
      empty:
        "No steps yet. Click an arrow of payment that checkout forwards to send its event. Its ? opens Details, where you can change what it sends.",
    });
  });

  test("an arrow the parent does not forward is locked with the reason, and a click sends nothing", () => {
    const { root, driver } = mountEntered({ steps: ["pay", "submit"] });
    const approve = arrow(root, { id: "verifying-approve-settled" });
    const reason = approve?.getAttribute("aria-description");
    press(approve);
    expect({
      reason,
      locked: approve?.classList.contains("blocked"),
      sent: driver.taken.length,
      details: root.querySelector("[data-blocked-note]")?.textContent,
    }).toStrictEqual({
      reason: "approve can't be sent: checkout does not forward it to payment; it forwards submit.",
      locked: true,
      sent: 2,
      details:
        "approve can't be sent: checkout does not forward it to payment; it forwards submit.",
    });
  });
});

describe("an entered machine while the root is elsewhere", () => {
  test("is drawn without its state, says why, and its arrows send nothing", () => {
    const { root, driver } = mountEntered({ steps: [] });
    press(arrow(root, { id: "card-submit-verifying" }));
    expect({ shown: walkShown(root), sent: driver.taken.length }).toStrictEqual({
      shown: {
        current: undefined,
        note: "payment runs only while checkout is in paying. It is in cart now, so payment is shown without its state.",
        empty:
          "No steps yet. The arrows of a machine shown without its state send nothing. Go back to checkout and click an arrow there.",
      },
      sent: 0,
    });
  });
});
