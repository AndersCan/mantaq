import { decodeFocus, focusOf, focusTokens } from "./focus.ts";
import { describe, expect, test } from "vite-plus/test";
import type { VizDocument, VizMachine } from "../../schema.ts";
import { documentOf } from "../../validate/embed-document.ts";

/** A board: the app's own `idle`, and the machines `stock` and `till` beside it; `till.paying` embeds `payment`. */
function boardDocument(): VizDocument {
  const shop = documentOf([
    {
      id: "app",
      states: [
        { id: "idle", role: "initial" },
        { id: "stock.counting", role: "initial" },
        { id: "till.open", role: "initial" },
        { id: "till.paying", machine: "payment" },
      ],
    },
    { id: "payment", states: [{ id: "card", role: "initial" }] },
  ]);
  const [app, payment] = shop.machines;
  if (app === undefined || payment === undefined) return shop;
  const board: VizMachine = {
    ...app,
    regions: ["stock", "till"],
    actors: ["stock", "till"],
    states: app.states.map((state) => {
      const region = state.id.includes(".") ? state.id.slice(0, state.id.indexOf(".")) : undefined;
      return region === undefined ? state : { ...state, region, initial: true };
    }),
  };
  return { ...shop, machines: [board, payment] };
}

describe("the path in the address bar on a board", () => {
  const viz = boardDocument();
  const root = viz.machines[0];

  test("names a machine of the board, the machine's own by its id, then a state that embeds one", () => {
    if (root === undefined) return;
    const own = focusOf(decodeFocus(["app"], { viz, root }), { viz, root });
    const entered = focusOf(decodeFocus(["till", "till.paying"], { viz, root }), { viz, root });
    expect({
      own: { tokens: focusTokens(own.steps), drawn: own.drawn.id, canvas: own.canvas },
      entered: {
        tokens: focusTokens(entered.steps),
        drawn: entered.drawn.id,
        crumbs: entered.crumbs,
        walk: entered.walk,
      },
    }).toStrictEqual({
      own: { tokens: ["app"], drawn: "app", canvas: "graph" },
      entered: {
        tokens: ["till", "till.paying"],
        drawn: "payment",
        crumbs: [
          { label: "app", keep: 0 },
          { label: "till", keep: 1 },
          { label: "payment", keep: 2 },
        ],
        walk: "static",
      },
    });
  });

  test("a state cannot be entered from the board, only from its machine", () => {
    if (root === undefined) return;
    expect(decodeFocus(["till.paying"], { viz, root })).toStrictEqual([]);
  });
});
