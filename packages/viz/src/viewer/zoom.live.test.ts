// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizFuzzMessage,
  VizLiveState,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";

const stateOf = (id: string, initial = false): VizState => ({
  id,
  label: id,
  region: id.includes(".") ? id.slice(0, id.indexOf(".")) : null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const edgeOf = (from: string, event: string, to: string): VizEdge => ({
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
});

/** The machine's own idle, and two machines p and q beside it. */
function boardOf(actors: string[]): VizMachine {
  const states = [
    stateOf("idle", true),
    ...actors.flatMap((actor) => [stateOf(`${actor}.one`, true), stateOf(`${actor}.two`)]),
  ];
  return {
    id: "app",
    initial: "idle",
    regions: actors,
    maps: [],
    actors,
    states,
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: actors.map((actor) => edgeOf(`${actor}.one`, "go", `${actor}.two`)),
    fuzz: null,
    runs: [],
  };
}

function fakeDriver(actors: string[]): VizDriver {
  const liveAt = (steps: ReadonlyArray<VizStep>): VizLiveState => ({
    state: "idle",
    steps: [...steps],
    last: null,
    after: [],
    timers: [],
    context: {},
    payload: null,
    regions: Object.fromEntries(
      actors.map((actor) => [actor, `${actor}.${actor === "q" ? "two" : "one"}`]),
    ),
    children: [],
    effectMode: "held",
    waiting: [],
  });
  return {
    reset: () => liveAt([]),
    step: (step) => liveAt([step]),
    listen: () => {},
    dryRun: (candidates) => candidates.map(() => null),
  };
}

function mount(actors: string[], drawn: VizMachine = boardOf(actors)) {
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [drawn] },
    { driver: fakeDriver(actors) },
  );
  return root;
}

let width = 632;
beforeEach(() => {
  width = 632;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const press = (element: Element | null) =>
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const box = (root: HTMLElement, part: string) =>
  root.querySelector<SVGGElement>(`g.part[data-part="${part}"]`);
function crumbs(root: HTMLElement) {
  return [...root.querySelectorAll(".focus-path button")].map((crumb) => crumb.textContent);
}
function boardCrumb(root: HTMLElement) {
  return root.querySelector(".focus-path button");
}
const viewBox = (root: HTMLElement) => root.querySelector("svg")?.getAttribute("viewBox");
const viewBoxWidth = (root: HTMLElement) => Number(viewBox(root)?.split(" ")[2]);

/** Counts calls to the two ways a page can be scrolled: `window.scrollBy` and `scrollIntoView`. */
function spyPageScroll(): () => number {
  const by = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const into = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  return () => by.mock.calls.length + into.mock.calls.length;
}

describe("a board of three machines", () => {
  test("opens as one box per machine, with no states and a hint", () => {
    const root = mount(["p", "q"]);
    expect([...root.querySelectorAll("g.part")].map((g) => g.getAttribute("data-part"))).toEqual([
      "",
      "p",
      "q",
    ]);
    expect(root.querySelectorAll("g[data-node-id]")).toHaveLength(0);
    expect(root.querySelector("[data-tab-panel=details] .muted")?.textContent).toBe(
      "Click a machine to see its states.",
    );
  });

  test("a click on a box shows only that machine and never scrolls the page", () => {
    const pageScrolls = spyPageScroll();
    const root = mount(["p", "q"]);
    press(box(root, "q"));
    expect(root.querySelectorAll("g.part")).toHaveLength(0);
    expect(
      [...root.querySelectorAll("g[data-node-id]")].map((g) => g.getAttribute("data-node-id")),
    ).toEqual(["q.one", "q.two"]);
    expect(pageScrolls()).toBe(0);
    expect(document.activeElement?.textContent).toBe("q");
  });

  test("Enter on a box opens it", () => {
    const root = mount(["p", "q"]);
    box(root, "p")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(root.querySelector("g[data-node-id='p.one']")).not.toBeNull();
    expect(root.querySelector("svg[data-zoom='p']")).not.toBeNull();
  });

  test("the path at the top leads back to the board", () => {
    const root = mount(["p", "q"]);
    press(box(root, ""));
    expect(root.querySelector("g[data-node-id='idle']")).not.toBeNull();
    expect(crumbs(root)).toEqual(["app", "app"]);
    press(boardCrumb(root));
    expect(root.querySelectorAll("g.part")).toHaveLength(3);
    expect(root.querySelector(".focus-path")).toBeNull();
  });

  test("a step keeps the machine shown, and Back and Reset do too", () => {
    const root = mount(["p", "q"]);
    press(box(root, "p"));
    press(root.querySelector("g.edge"));
    expect(root.querySelector("g[data-node-id='p.one']")).not.toBeNull();
    expect(root.querySelector("g[data-node-id='q.one']")).toBeNull();
  });

  test("a new window width draws the board again; the same width does not", () => {
    const root = mount(Array.from({ length: 12 }, (_, index) => `machine${index}`));
    const before = root.querySelector("svg");
    window.dispatchEvent(new Event("resize"));
    expect(root.querySelector("svg")).toBe(before);
    const narrow = viewBoxWidth(root);
    width = 2000;
    window.dispatchEvent(new Event("resize"));
    expect(root.querySelector("svg")).not.toBe(before);
    expect(viewBoxWidth(root)).not.toBe(narrow);
  });

  test("a window that has no width yet lays the board out at 800 units", () => {
    width = 0;
    const unmeasured = viewBox(mount(Array.from({ length: 12 }, (_, i) => `machine${i}`)));
    width = 720;
    const measured = viewBox(mount(Array.from({ length: 12 }, (_, i) => `machine${i}`)));
    expect(unmeasured).toBe(measured);
  });

  test("a viewer taken off the page ignores the window", () => {
    const root = mount(Array.from({ length: 12 }, (_, index) => `machine${index}`));
    const before = root.querySelector("svg");
    root.remove();
    width = 2000;
    window.dispatchEvent(new Event("resize"));
    expect(root.querySelector("svg")).toBe(before);
  });

  test("a resize leaves a shown machine alone", () => {
    const root = mount(["p", "q"]);
    press(box(root, "p"));
    const shown = root.querySelector("svg");
    width = 2000;
    window.dispatchEvent(new Event("resize"));
    expect(root.querySelector("svg")).toBe(shown);
  });
});

describe("the wires of a board", () => {
  const withMessages = (messages: VizFuzzMessage[]): VizMachine => {
    const drawn = boardOf(["p", "q"]);
    return {
      ...drawn,
      fuzz: {
        seed: 1,
        iterations: 1,
        corpus: [],
        errors: [],
        failedExpectations: [],
        expectations: [],
        messages,
      },
    };
  };
  const message = (from: string, to: string): VizFuzzMessage => ({ from, event: `to_${to}`, to });

  test("a one-way pair has an arrowhead at one end, a two-way pair at both", () => {
    const one = mount(["p", "q"], withMessages([message("p.one", "q.one")]));
    const wire = one.querySelector("g.message path");
    expect(wire?.getAttribute("marker-end")).toBe("url(#viz-arrow)");
    expect(wire?.hasAttribute("marker-start")).toBe(false);
    const both = mount(
      ["p", "q"],
      withMessages([message("p.one", "q.one"), message("q.one", "p.one")]),
    );
    expect(both.querySelector("g.message path")?.getAttribute("marker-start")).toBe(
      "url(#viz-arrow)",
    );
  });
});

describe("a machine with no live state", () => {
  test("opens without scrolling the page", () => {
    const pageScrolls = spyPageScroll();
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [boardOf(["p", "q"])] });
    press(box(root, "p"));
    expect(pageScrolls()).toBe(0);
  });
});

describe("a board of two machines", () => {
  test("is drawn as before, with every state and no boxes", () => {
    const root = mount(["p"]);
    expect(root.querySelectorAll("g.part")).toHaveLength(0);
    expect(root.querySelectorAll("g[data-node-id]").length).toBeGreaterThan(2);
    expect(root.querySelector(".focus-path")).toBeNull();
  });
});

describe("repro: Show controls while a machine is shown", () => {
  test("the path still leads back", () => {
    const actors = ["p", "q"];
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [boardOf(actors)] },
      { driver: fakeDriver(actors), diagramOnly: true },
    );
    press(box(root, "p"));
    expect(crumbs(root)).toEqual(["app", "p"]);
    press(root.querySelector("[data-show-controls]"));
    expect(root.querySelector("g[data-node-id='p.one']")).not.toBeNull();
    press(boardCrumb(root));
    expect(root.querySelectorAll("g.part")).toHaveLength(3);
  });
});

describe("repro: a step inside a shown machine", () => {
  test("scrolls the canvas to that machine's new state", () => {
    const at: Record<string, number> = { "p.one": 0, "p.two": 3000 };
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("canvas") ? 6000 : 0;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const id = this.getAttribute("data-node-id");
      const canvas = this.closest(".canvas");
      const x = id !== null && id in at ? at[id]! - (canvas?.scrollLeft ?? 0) : 0;
      const w = id !== null && id in at ? 120 : 0;
      return {
        left: x,
        right: x + w,
        top: 0,
        bottom: 40,
        width: w,
        height: 40,
        x,
        y: 0,
      } as DOMRect;
    });
    const scrolls: number[] = [];
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
    ) {
      if (typeof options === "object") scrolls.push(options.left ?? -1);
    });
    const actors = ["p", "q"];
    const drawn = boardOf(actors);
    const driver: VizDriver = {
      ...fakeDriver(actors),
      step: (step) => ({
        ...fakeDriver(actors).step(step),
        regions: { p: "p.two", q: "q.two" },
      }),
    };
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [drawn] }, { driver });
    press(box(root, "p"));
    press(root.querySelector("g.edge"));
    expect(root.querySelector("g[data-node-id='p.two']")?.classList.contains("current")).toBe(true);
    expect(scrolls.at(-1)).toBeGreaterThan(2000);
  });
});

describe("repro: Back and Reset, and the Details hint, in a shown machine", () => {
  const buttonNamed = (root: HTMLElement, name: string) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent === name) ?? null;
  test("Back and Reset keep the machine", () => {
    const root = mount(["p", "q"]);
    press(box(root, "p"));
    press(root.querySelector("g.edge"));
    press(buttonNamed(root, "Back"));
    expect(root.querySelector("g[data-node-id='p.one']")).not.toBeNull();
    press(root.querySelector("g.edge"));
    press(buttonNamed(root, "Reset"));
    expect(root.querySelector("g[data-node-id='p.one']")).not.toBeNull();
    expect(root.querySelector("g.part")).toBeNull();
  });
  test("the Details hint follows what is drawn", () => {
    const root = mount(["p", "q"]);
    const hint = () => root.querySelector("[data-tab-panel=details] .muted")?.textContent;
    press(box(root, "p"));
    expect(hint()).toBe("Click a state or an arrow in the diagram.");
    press(boardCrumb(root));
    expect(hint()).toBe("Click a machine to see its states.");
  });
});

describe("a step inside a shown machine", () => {
  const stubRects = (below: boolean, belowId = "p.two") => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const scrolled = this.closest(".canvas")?.scrollTop ?? 0;
      const top = this.classList.contains("viz-bar")
        ? 0
        : this.classList.contains("panel")
          ? 500
          : this.classList.contains("canvas")
            ? 100
            : this.getAttribute("data-node-id") === belowId && below
              ? 900 - scrolled
              : 200 - scrolled;
      return {
        top,
        bottom: top + 40,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: top,
      } as DOMRect;
    });
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("canvas") ? 400 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("canvas") ? 2000 : 0;
    });
  };
  const mountPushable = (actors = ["p", "q"]) => {
    let push: (state: VizLiveState) => void = () => {};
    const driver = fakeDriver(actors);
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [boardOf(actors)] },
      {
        driver: {
          ...driver,
          listen: (callback) => {
            push = callback;
          },
        },
      },
    );
    const at = (p: string, q: string): VizLiveState => ({
      ...driver.reset(),
      regions: { p, q },
    });
    return { root, push: (p: string, q: string) => push(at(p, q)), at };
  };
  const spy = () => {
    const tops: number[] = [];
    const pageScrolls = spyPageScroll();
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
    ) {
      if (typeof options !== "object") return;
      tops.push(options.top ?? -1);
      this.scrollTop = options.top ?? 0;
    });
    return { tops, pageScrolls };
  };

  test("scrolls the canvas once to the new state below the band, never the page", () => {
    stubRects(true);
    const { tops, pageScrolls } = spy();
    const { root, push } = mountPushable();
    press(box(root, "p"));
    tops.length = 0;
    push("p.two", "q.two");
    expect(tops).toEqual([456]);
    expect(pageScrolls()).toBe(0);
  });

  test("keeps the new state below the name bar and above a Step panel that covers the canvas", () => {
    stubRects(true);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const scrolled = this.closest(".canvas")?.scrollTop ?? 0;
      const top = this.classList.contains("viz-bar")
        ? 160
        : this.classList.contains("panel")
          ? 300
          : this.classList.contains("canvas")
            ? 100
            : this.getAttribute("data-node-id") === "p.two"
              ? 900 - scrolled
              : 200 - scrolled;
      return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40 } as DOMRect;
    });
    const { tops, pageScrolls } = spy();
    const { root, push } = mountPushable();
    press(box(root, "p"));
    tops.length = 0;
    push("p.two", "q.two");
    push("p.one", "q.one");
    expect(tops).toEqual([656, 0]);
    expect(pageScrolls()).toBe(0);
  });

  test("keeps the new state inside the window when the canvas runs past its bottom", () => {
    stubRects(true);
    vi.stubGlobal("innerHeight", 300);
    const { tops, pageScrolls } = spy();
    const { root, push } = mountPushable();
    press(box(root, "p"));
    tops.length = 0;
    push("p.two", "q.two");
    push("p.one", "q.one");
    expect(tops).toEqual([656, 84]);
    expect(pageScrolls()).toBe(0);
  });

  test("leaves the page alone when the state shows, or the step is in another machine", () => {
    stubRects(false);
    const { tops: scrolled, pageScrolls } = spy();
    const { root, push } = mountPushable();
    press(box(root, "p"));
    scrolled.length = 0;
    push("p.two", "q.two");
    push("p.one", "q.one");
    expect(scrolled).toEqual([]);
    expect(pageScrolls()).toBe(0);
  });

  test("a step in another machine never scrolls", () => {
    stubRects(true);
    const { tops: scrolled } = spy();
    const { root, push } = mountPushable();
    press(box(root, "p"));
    scrolled.length = 0;
    push("p.one", "q.one");
    expect(scrolled).toEqual([]);
  });

  test("a machine without parts never scrolls the page on a step", () => {
    stubRects(true);
    const { tops: scrolled } = spy();
    const { root, push } = mountPushable(["p"]);
    expect(root.querySelector("g.part")).toBeNull();
    expect(root.querySelector("g[data-node-id='p.two']")).not.toBeNull();
    push("p.two", "q.two");
    expect(scrolled).toEqual([]);
  });

  test("opening on a state outside the band scrolls the canvas once, then a step in another machine does not", () => {
    stubRects(true, "p.one");
    const { tops: scrolled, pageScrolls } = spy();
    const { root, push } = mountPushable();
    press(box(root, "p"));
    expect(scrolled).toEqual([456]);
    push("p.one", "q.one");
    expect(scrolled).toEqual([456]);
    expect(pageScrolls()).toBe(0);
  });

  test("an unzoomed board never scrolls the page", () => {
    stubRects(true);
    const { tops: scrolled } = spy();
    const { push } = mountPushable();
    push("p.two", "q.one");
    expect(scrolled).toEqual([]);
  });
});
