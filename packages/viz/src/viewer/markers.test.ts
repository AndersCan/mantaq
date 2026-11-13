// @vitest-environment happy-dom
import type { VizEdge, VizLiveChild, VizMachine, VizState } from "../schema.ts";
import { renderGraph } from "./graph.ts";
import { drawChildMarkers } from "./markers.ts";
import type { MarkerContext } from "./markers.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id.slice(id.lastIndexOf(".") + 1),
    region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
    initial: flags.initial ?? false,
    final: flags.final ?? false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(from: string, event: string, to: string): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

const machine: VizMachine = {
  id: "photoQueue",
  initial: "showingQueue",
  regions: ["photos"],
  maps: ["photos"],
  actors: [],
  states: [
    state("showingQueue", { initial: true }),
    state("photos.sendingPhoto", { initial: true }),
    state("photos.photoSent", { final: true }),
  ],
  events: [],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [edge("photos.sendingPhoto", "uploadConfirmed", "photos.photoSent")],
  runs: [],
  fuzz: null,
};

const child = (key: string, at = "sendingPhoto"): VizLiveChild => ({
  map: "photos",
  key,
  state: `photos.${at}`,
  since: 1,
});

function draw(
  children: VizLiveChild[],
  extra: Partial<MarkerContext> = {},
  into?: SVGSVGElement,
): SVGSVGElement {
  const graph =
    into ??
    renderGraph(document, machine, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
  drawChildMarkers(graph, {
    machine,
    children,
    picked: null,
    motion: false,
    onPick: () => undefined,
    ...extra,
  });
  return graph;
}

const cy = (marker: Element) =>
  Number(/, ([-\d.]+)px/.exec((marker as SVGGElement).style.transform)?.[1]);
const markers = (graph: Element) => [...graph.querySelectorAll<SVGGElement>("g.child-marker")];
const tx = (marker: Element) =>
  Number(/translate\(([-\d.]+)px/.exec((marker as SVGGElement).style.transform)?.[1]);

function box(graph: Element, id: string) {
  const frame = graph.querySelector(`g[data-node-id="${id}"] > rect.frame`);
  const n = (name: string) => Number(frame?.getAttribute(name));
  return { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
}

describe("child markers", () => {
  test("three children are three labelled pills in their state", () => {
    const graph = draw([child("p1"), child("p2"), child("p3")]);
    const all = markers(graph);
    expect(all.map((each) => each.getAttribute("data-marker-key"))).toEqual(["p1", "p2", "p3"]);
    expect(
      all.every((each) => each.getAttribute("data-marker-state") === "photos.sendingPhoto"),
    ).toBe(true);
    expect(tx(all[0]!)).toBeLessThan(tx(all[1]!));
    expect(tx(all[1]!)).toBeLessThan(tx(all[2]!));
    expect(all[0]?.getAttribute("aria-label")).toBe("p1, in sendingPhoto");
  });

  test("a marker never covers the state name and stays inside its state", () => {
    const keys = ["p1", "p2", "p3", "p4", "p5", "p6"];
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const graph = draw(keys.slice(0, count).map((key) => child(key)));
      const frame = box(graph, "photos.sendingPhoto");
      for (const each of markers(graph)) {
        const rect = each.querySelector("rect");
        const left = tx(each);
        const width = Number(rect?.getAttribute("width"));
        const top = Number(/, ([-\d.]+)px/.exec((each as SVGGElement).style.transform)?.[1]) - 7;
        expect(left).toBeGreaterThanOrEqual(frame.x);
        expect(left + width).toBeLessThanOrEqual(frame.x + frame.width);
        expect(top).toBeGreaterThanOrEqual(frame.y + 26);
      }
    }
    const long = draw([child("abcdefghij")]);
    const frame = box(long, "photos.sendingPhoto");
    const [only] = markers(long);
    const width = Number(only?.querySelector("rect")?.getAttribute("width"));
    expect(tx(only!) + width).toBeLessThanOrEqual(frame.x + frame.width);
  });

  test("seven children in one state are dots with a count of 7", () => {
    const graph = draw(Array.from({ length: 7 }, (_, i) => child(`p${i + 1}`)));
    expect(markers(graph).every((each) => each.classList.contains("dot"))).toBe(true);
    expect(markers(graph)).toHaveLength(7);
    expect(graph.querySelector(".marker-count")?.getAttribute("data-marker-count")).toBe("7");
  });

  test("a long key is cut on the pill and whole in its title and name", () => {
    const [only] = markers(draw([child("abcdefghijkl")]));
    expect(only?.querySelector("text")?.textContent).toBe("abcdefg…");
    expect(only?.querySelector("title")?.textContent).toBe("abcdefghijkl");
    expect(only?.getAttribute("aria-label")).toBe("abcdefghijkl, in sendingPhoto");
  });

  test("an empty key shows as two quotes", () => {
    const [only] = markers(draw([child("")]));
    expect(only?.querySelector("text")?.textContent).toBe('""');
    expect(only?.getAttribute("aria-label")).toBe('"", in sendingPhoto');
  });

  test("a finished child's pill is outlined", () => {
    const graph = draw([child("p1"), child("p2", "photoSent")]);
    const [live, done] = markers(graph);
    expect(live?.classList.contains("final")).toBe(false);
    expect(done?.classList.contains("final")).toBe(true);
  });

  test("a kept marker keeps its element when it moves", () => {
    const graph = draw([child("p1")]);
    const [before] = markers(graph);
    const was = before?.style.transform;
    draw([child("p1", "photoSent")], {}, graph);
    const [after] = markers(graph);
    expect(after).toBe(before);
    expect(after?.style.transform).not.toBe(was);
    expect(after?.getAttribute("data-marker-state")).toBe("photos.photoSent");
  });

  test("motion false marks the layer still and creates no entering marker", () => {
    const still = draw([child("p1")]);
    expect(still.querySelector(".child-markers")?.classList.contains("still")).toBe(true);
    expect(still.querySelector(".entering")).toBeNull();
    const moving = draw([child("p1"), child("p2")], { motion: true }, still);
    expect(moving.querySelector(".child-markers")?.classList.contains("still")).toBe(false);
    expect(moving.querySelectorAll(".entering")).toHaveLength(1);
    draw([child("p1"), child("p2")], { motion: true }, still);
    expect(still.querySelector(".entering")).toBeNull();
  });

  test("markers of removed children are removed", () => {
    const graph = draw([child("p1"), child("p2")]);
    draw([child("p2")], {}, graph);
    expect(markers(graph).map((each) => each.getAttribute("data-marker-key"))).toEqual(["p2"]);
    draw([], {}, graph);
    expect(markers(graph)).toHaveLength(0);
  });

  test("arrow keys move focus between markers and do not reach the root", () => {
    const graph = draw([child("p1"), child("p2"), child("p3")]);
    document.body.append(graph);
    const seen: string[] = [];
    document.body.addEventListener("keydown", (event) => seen.push(event.key));
    const [a, b, c] = markers(graph);
    a?.focus();
    a?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(b);
    b?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(c);
    c?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(c);
    c?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(a);
    b?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(a);
    expect(seen).toEqual([]);
    expect(a?.getAttribute("tabindex")).toBe("0");
    expect(b?.getAttribute("tabindex")).toBe("-1");
    graph.remove();
  });

  test("one marker has tabindex 0", () => {
    const graph = draw([child("p1"), child("p2"), child("p3")]);
    expect(markers(graph).filter((each) => each.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  test("click and Enter pick; a picked marker click drops the pick", () => {
    const picks: Array<{ map: string; key: string } | null> = [];
    const onPick = (next: { map: string; key: string } | null) => picks.push(next);
    const graph = draw([child("p1"), child("p2")], { onPick });
    const [a] = markers(graph);
    a?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    a?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    a?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(picks).toEqual([
      { map: "photos", key: "p1" },
      { map: "photos", key: "p1" },
      { map: "photos", key: "p1" },
    ]);
    draw([child("p1"), child("p2")], { onPick, picked: { map: "photos", key: "p1" } }, graph);
    expect(a?.getAttribute("aria-pressed")).toBe("true");
    a?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picks.at(-1)).toBeNull();
  });

  test("a child whose state is not drawn gets no marker", () => {
    expect(markers(draw([child("p1", "nowhere")]))).toHaveLength(0);
  });
});

describe("pills or dots", () => {
  test("more than six pills become dots even when they fit", () => {
    const graph = draw(Array.from({ length: 7 }, (_, i) => child(String(i + 1))));
    expect(markers(graph).every((each) => each.classList.contains("dot"))).toBe(true);
  });

  test("six pills that do not fit become dots", () => {
    const graph = draw(Array.from({ length: 6 }, (_, i) => child(`photo-${i + 1}`)));
    expect(markers(graph).every((each) => each.classList.contains("dot"))).toBe(true);
    expect(graph.querySelector(".marker-count")?.getAttribute("data-marker-count")).toBe("6");
  });

  test("dots stay inside their state and the rest are counted", () => {
    const graph = draw(Array.from({ length: 40 }, (_, i) => child(`p${i + 1}`)));
    const frame = box(graph, "photos.sendingPhoto");
    const shown = markers(graph);
    expect(shown.length).toBeLessThan(40);
    expect(graph.querySelector(".marker-count")?.getAttribute("data-marker-count")).toBe("40");
    for (const each of shown) expect(tx(each) + 8).toBeLessThanOrEqual(frame.x + frame.width);
  });
});

describe("pill boundary and bounds", () => {
  test("six two-character keys exactly fill the state and are pills; seven are dots", () => {
    const six = draw(["aa", "bb", "cc", "dd", "ee", "ff"].map((key) => child(key)));
    expect(markers(six).some((each) => each.classList.contains("dot"))).toBe(false);
    const frame = box(six, "photos.sendingPhoto");
    const edges = markers(six).map((each) => {
      const left = tx(each);
      return [left, left + Number(each.querySelector("rect")?.getAttribute("width"))] as const;
    });
    expect(Math.min(...edges.map(([l]) => l))).toBeGreaterThanOrEqual(frame.x + 8);
    expect(Math.max(...edges.map(([, r]) => r))).toBeLessThanOrEqual(frame.x + frame.width - 8);
    const seven = draw(["aa", "bb", "cc", "dd", "ee", "ff", "gg"].map((key) => child(key)));
    expect(markers(seven).every((each) => each.classList.contains("dot"))).toBe(true);
  });

  test("pills sit inside the frame at the bottom, not below it", () => {
    const graph = draw([child("p1"), child("p2")]);
    const frame = box(graph, "photos.sendingPhoto");
    for (const each of markers(graph)) {
      expect(cy(each) + 7).toBeLessThanOrEqual(frame.y + frame.height);
      expect(cy(each)).toBeGreaterThan(frame.y + frame.height - 14);
      expect(each.classList.contains("dot")).toBe(false);
    }
  });

  test("dots and their count stay inside the frame", () => {
    const graph = draw(Array.from({ length: 40 }, (_, i) => child(`p${i + 1}`)));
    const frame = box(graph, "photos.sendingPhoto");
    const count = graph.querySelector<SVGElement>(".marker-count");
    const countLeft = tx(count!);
    expect(countLeft + String(40).length * 6).toBeLessThanOrEqual(frame.x + frame.width - 8);
    expect(markers(graph)).toHaveLength(11);
    const last = Math.max(...markers(graph).map((each) => tx(each) + 8));
    expect(last).toBeLessThanOrEqual(countLeft);
    expect(cy(count!)).toBeLessThanOrEqual(frame.y + frame.height);
  });
});

describe("roving focus and picks", () => {
  const key = (name: string) =>
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  const tabbable = (graph: Element) =>
    markers(graph)
      .filter((each) => each.getAttribute("tabindex") === "0")
      .map((each) => each.getAttribute("data-marker-key"));

  test("ArrowRight on the last marker keeps exactly one in the tab order", () => {
    const graph = draw([child("p1"), child("p2")]);
    document.body.append(graph);
    const [, b] = markers(graph);
    b?.focus();
    b?.dispatchEvent(key("ArrowRight"));
    expect(tabbable(graph)).toEqual(["p2"]);
    b?.dispatchEvent(key("ArrowLeft"));
    b?.dispatchEvent(key("ArrowLeft"));
    expect(tabbable(graph)).toEqual(["p1"]);
    graph.remove();
  });

  test("after a redraw the focused marker keeps the tab stop, else the picked one", () => {
    const graph = draw([child("p1"), child("p2"), child("p3")]);
    document.body.append(graph);
    const [, b] = markers(graph);
    b?.focus();
    b?.dispatchEvent(key("End"));
    draw([child("p1"), child("p2"), child("p3")], {}, graph);
    expect(tabbable(graph)).toEqual(["p3"]);
    draw([child("p1"), child("p2")], { picked: { map: "photos", key: "p2" } }, graph);
    expect(tabbable(graph)).toEqual(["p2"]);
    draw([child("p1"), child("p2")], {}, graph);
    expect(tabbable(graph)).toEqual(["p2"]);
    graph.remove();
  });

  test("the picked marker gets the tab stop on a fresh draw", () => {
    const graph = draw([child("p1"), child("p2")], { picked: { map: "photos", key: "p2" } });
    expect(tabbable(graph)).toEqual(["p2"]);
  });

  test("the tab stop follows the picked map when two maps share a key", () => {
    const two: VizMachine = {
      ...machine,
      maps: ["photos", "docs"],
      actors: [],
      regions: ["photos", "docs"],
      states: [...machine.states, state("docs.sendingPhoto", { initial: true })],
    };
    const docs: VizLiveChild = { ...child("p1"), map: "docs", state: "docs.sendingPhoto" };
    const graph = renderGraph(document, two, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
    drawChildMarkers(graph, {
      machine: two,
      children: [child("p1"), docs],
      picked: { map: "docs", key: "p1" },
      motion: false,
      onPick: () => undefined,
    });
    expect(
      markers(graph).map(
        (each) => each.getAttribute("data-marker-map") + ":" + each.getAttribute("tabindex"),
      ),
    ).toEqual(["photos:-1", "docs:0"]);
  });

  test("Space and Enter prevent the page scroll and pick", () => {
    const graph = draw([child("p1")]);
    const [a] = markers(graph);
    for (const name of [" ", "Enter"]) {
      const event = key(name);
      a?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    const other = key("a");
    a?.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  test("the same key in two maps is picked as one marker", () => {
    const two: VizMachine = {
      ...machine,
      maps: ["photos", "docs"],
      actors: [],
      regions: ["photos", "docs"],
      states: [...machine.states, state("docs.sendingPhoto", { initial: true })],
    };
    const docs: VizLiveChild = { ...child("p1"), map: "docs", state: "docs.sendingPhoto" };
    const graph = renderGraph(document, two, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
    drawChildMarkers(graph, {
      machine: two,
      children: [child("p1"), docs],
      picked: { map: "docs", key: "p1" },
      motion: false,
      onPick: () => undefined,
    });
    expect(markers(graph).map((each) => each.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
  });
});
