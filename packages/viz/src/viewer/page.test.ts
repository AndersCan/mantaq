// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { edgeOf, machineOf, stateOf } from "./groups/shop-machines.ts";
import type { FocusLink } from "./embed.ts";
import { linkOptions } from "./page.ts";
import { mountViewer } from "./embed.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDocument } from "../schema.ts";

const oneState: VizDocument = {
  schemaVersion: VIZ_SCHEMA_VERSION,
  machines: [
    machineOf({
      states: [stateOf("open", { initial: true })],
      edges: [edgeOf("__initial__", { event: "", to: "open", kind: "initial" })],
    }),
  ],
};

describe("the address bar", () => {
  test("opens on the payloads in the address and writes them back with the walk", () => {
    history.replaceState(
      undefined,
      "",
      "?machine=answer&step=ask&payload=ask%3D%7B%22code%22%3A%22c1%22%7D",
    );
    const options = linkOptions();
    expect(options.payloads).toEqual(['ask={"code":"c1"}']);
    options.onNavigate?.({
      by: "walk",
      machine: "answer",
      steps: ["ask", "answered"],
      payloads: ['ask={"code":"c2"}'],
      focus: [],
    });
    const params = new URLSearchParams(location.search);
    expect(params.getAll("payload")).toEqual(['ask={"code":"c2"}']);
    expect(params.getAll("step")).toEqual(["ask", "answered"]);
  });

  test("an old link's values are read, and the next walk writes them as payloads", () => {
    history.replaceState(undefined, "", "?machine=answer&value=code%3D%22c1%22&value=n%3D2");
    const options = linkOptions();
    expect(options.values).toEqual(['code="c1"', "n=2"]);
    options.onNavigate?.({
      by: "walk",
      machine: "answer",
      steps: [],
      payloads: ['ask={"code":"c1"}'],
      focus: [],
    });
    const params = new URLSearchParams(location.search);
    expect([params.has("value"), params.getAll("payload")]).toEqual([false, ['ask={"code":"c1"}']]);
  });

  test("clearing the last payload removes it from the address", () => {
    history.replaceState(undefined, "", "?machine=answer&payload=ask%3D%7B%7D");
    linkOptions().onNavigate?.({
      by: "walk",
      machine: "answer",
      steps: [],
      payloads: [],
      focus: [],
    });
    expect(new URLSearchParams(location.search).has("payload")).toBe(false);
  });

  test("the reader's move along the path adds a history entry; a step and a move that follows Back replace the entry", () => {
    history.replaceState(undefined, "", "?machine=order&step=placeOrder&focus=%40nowhere#walk");
    const options = linkOptions();
    const before = history.length;
    const walk = { machine: "order", payloads: [] };
    const added: number[] = [];
    options.onNavigate?.({ ...walk, by: "path", steps: ["placeOrder"], focus: ["@payment"] });
    added.push(history.length - before);
    options.onNavigate?.({
      ...walk,
      by: "walk",
      steps: ["placeOrder", "declined"],
      focus: ["@payment"],
    });
    added.push(history.length - before);
    options.onNavigate?.({ ...walk, by: "link", steps: ["placeOrder", "declined"], focus: [] });
    added.push(history.length - before);
    const params = new URLSearchParams(location.search);
    expect({ added, steps: params.getAll("step"), hash: location.hash }).toEqual({
      added: [1, 1, 1],
      steps: ["placeOrder", "declined"],
      hash: "#walk",
    });
  });

  test("Back and Forward hand the viewer the path and the machine the address names", () => {
    history.replaceState(undefined, "", "?machine=order");
    const links: FocusLink[] = [];
    let mounted = true;
    linkOptions().followFocus?.({ follow: (link) => links.push(link), mounted: () => mounted });
    history.replaceState(undefined, "", "?machine=order&focus=%40payment");
    dispatchEvent(new PopStateEvent("popstate"));
    history.replaceState(undefined, "", "?");
    dispatchEvent(new PopStateEvent("popstate"));
    mounted = false;
    dispatchEvent(new PopStateEvent("popstate"));
    expect(links).toEqual([{ machine: "order", focus: ["@payment"] }, { focus: [] }]);
  });

  test("a page that mounts its viewer again hands Back to the new viewer only", () => {
    history.replaceState(undefined, "", "?machine=order");
    const told: string[] = [];
    const root = document.createElement("div");
    document.body.append(root);
    for (const name of ["first", "second"]) {
      mountViewer(root, oneState, {
        followFocus: (follower) =>
          linkOptions().followFocus?.({ ...follower, follow: () => told.push(name) }),
      });
    }
    dispatchEvent(new PopStateEvent("popstate"));
    root.remove();
    dispatchEvent(new PopStateEvent("popstate"));
    expect(told).toEqual(["second"]);
  });
});
