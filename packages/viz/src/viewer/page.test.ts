// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vite-plus/test";
import { edgeOf, machineOf, stateOf } from "./groups/shop-machines.ts";
import { linkOptions } from "./page.ts";
import { mountViewer } from "./embed.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDocument } from "../schema.ts";
import { walkDriver } from "./groups/walk-driver.ts";

const shop = machineOf({
  states: [
    stateOf("inCart", { initial: true }),
    stateOf("chargingCard", { group: "payment" }),
    stateOf("confirming", { group: "payment" }),
  ],
  edges: [
    edgeOf("__initial__", { event: "", to: "inCart", kind: "initial" }),
    edgeOf("inCart", { event: "checkout", to: "chargingCard" }),
    edgeOf("chargingCard", { event: "charged", to: "confirming" }),
  ],
});

const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shop] };

afterEach(() => {
  document.body.replaceChildren();
});

/** A click as a browser sends it: the pointer goes down first. */
function press(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("the address bar", () => {
  test("opens on the machine, run, steps, payloads and path the link names", () => {
    history.replaceState(
      undefined,
      "",
      "?machine=answer&run=Asked&step=ask&payload=ask%3D%7B%22code%22%3A%22c1%22%7D&focus=%40payment",
    );
    expect(linkOptions()).toEqual({
      machine: "answer",
      run: "Asked",
      steps: ["ask"],
      payloads: ['ask={"code":"c1"}'],
      values: [],
      focus: ["@payment"],
    });
  });

  test("an old link's values are read", () => {
    history.replaceState(undefined, "", "?machine=answer&value=code%3D%22c1%22&value=n%3D2");
    expect(linkOptions().values).toEqual(['code="c1"', "n=2"]);
  });

  test("a run without a machine is not read", () => {
    history.replaceState(undefined, "", "?run=Asked");
    expect(linkOptions().run).toBeUndefined();
  });

  test("a step and a move along the path leave the address and the history as they were", () => {
    history.replaceState(undefined, "", "?machine=shop#walk");
    const before = { search: location.search, hash: location.hash, entries: history.length };
    const root = document.createElement("div");
    document.body.append(root);
    const { driver } = walkDriver(shop, { guarded: new Set() });
    mountViewer(root, viz, { ...linkOptions(), driver });
    press(root.querySelector('.machine-enter[data-enter-group="@payment"]'));
    press(root.querySelector('.canvas g.edge[data-edge-id="inCart-checkout-chargingCard"]'));
    const entered = root.querySelector(".focus-path") !== null;
    const walked = root.querySelector('.canvas g.current[data-node-id="chargingCard"]') !== null;
    const after = { search: location.search, hash: location.hash, entries: history.length };
    expect({ entered, walked, after }).toEqual({ entered: true, walked: true, after: before });
  });
});
