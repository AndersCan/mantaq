import { describe, expect, test } from "vite-plus/test";
import type { VizLiveEmbed, VizLiveState, VizMachine } from "../../../schema.ts";
import { documentOf } from "../../../validate/embed-document.ts";
import { enteredWalk } from "./entered-walk.ts";
import { focusOf } from "../focus.ts";

const shop = documentOf([
  {
    id: "checkout",
    states: [
      { id: "cart", role: "initial" },
      { id: "paying", machine: "payment", forward: ["submit"] },
      { id: "gift.wrapping", machine: "payment" },
    ],
  },
  {
    id: "payment",
    states: [
      { id: "card", role: "initial" },
      { id: "verifying", machine: "fraud" },
    ],
  },
  { id: "fraud", states: [{ id: "scoring", role: "initial" }] },
]);

const [checkout] = shop.machines;

interface LiveOptions {
  state: string;
  regions?: Record<string, string>;
  embeds?: VizLiveEmbed[];
}

function liveAt(options: LiveOptions): VizLiveState {
  return {
    state: options.state,
    regions: options.regions ?? {},
    children: [],
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: {},
    payload: null,
    effectMode: "held",
    waiting: [],
    ...(options.embeds === undefined ? {} : { embeds: options.embeds }),
  };
}

interface WalkOptions {
  root: VizMachine | undefined;
  enter: string[];
  live: VizLiveState;
}

function walkOf(options: WalkOptions) {
  const { root, enter, live } = options;
  if (root === undefined) return undefined;
  const steps = enter.map((state) => ({ kind: "enter" as const, state }));
  return enteredWalk(focusOf(steps, { viz: shop, root }), { root, live });
}

/** The states entered from the root, in order. */
interface EnterPath {
  enter: string[];
}

describe("enteredWalk", () => {
  test("a running child sends to the root, with the inputs the document forwards", () => {
    const live = liveAt({ state: "paying", embeds: [{ state: "paying", current: "card" }] });
    const walk = walkOf({ root: checkout, enter: ["paying"], live });
    expect(
      walk?.kind === "running" ? [walk.run.current, walk.run.forward, walk.run.actor] : walk,
    ).toEqual(["card", ["submit"], undefined]);
  });

  test("a child in a region sends to that region", () => {
    const live = liveAt({
      state: "cart",
      regions: { gift: "gift.wrapping" },
      embeds: [{ state: "gift.wrapping", current: "card" }],
    });
    const walk = walkOf({ root: checkout, enter: ["gift.wrapping"], live });
    expect(walk?.kind === "running" ? [walk.run.forward, walk.run.actor] : walk).toEqual([
      [],
      { region: "gift" },
    ]);
  });

  test("each reason to draw the child without its state has its own note", () => {
    function noteOf(
      live: VizLiveState,
      path: EnterPath = { enter: ["paying"] },
    ): string | undefined {
      const walk = walkOf({ root: checkout, enter: path.enter, live });
      return walk?.kind === "static" ? walk.note : walk?.kind;
    }
    expect({
      noKeep: noteOf(liveAt({ state: "paying", embeds: [{ state: "paying" }] })),
      ended: noteOf(liveAt({ state: "paying", embeds: [] })),
      notReported: noteOf(liveAt({ state: "paying" })),
      deep: noteOf(liveAt({ state: "paying", embeds: [] }), { enter: ["paying", "verifying"] }),
    }).toEqual({
      noKeep:
        "payment is shown without its state: checkout does not say where it keeps the snapshot of payment (the embed option keep).",
      ended: "payment ended, so it is shown without its state.",
      notReported:
        "payment is shown without its state: the driver does not report the machines that checkout embeds.",
      deep: "fraud is shown without its state: only a machine that checkout embeds runs live here.",
    });
  });
});
