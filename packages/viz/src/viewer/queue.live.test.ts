// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizJson, VizLiveChild, VizLiveState, VizMachine } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import team from "./reference/team-inbox.json" with { type: "json" };
import { expect, test } from "vite-plus/test";

const pool = team as unknown as VizMachine;

function mount(waiting: string[], children: VizLiveChild[] = [], state = "workWaiting") {
  const live: VizLiveState = {
    state,
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: { waiting, free: [], workers: [], size: 3 } as VizJson,
    payload: null,
    regions: {},
    children,
    effectMode: "real",
    waiting: [],
  };
  const driver: VizDriver = { reset: () => live, step: () => live };
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] }, { driver });
  return root;
}

const items = (root: HTMLElement) =>
  Array.from(root.querySelectorAll(".graph g.queued-item")).map((each) =>
    each.getAttribute("data-queue-item"),
  );

test("nothing waits: no queue and no 0 waiting", () => {
  const root = mount([]);
  expect(root.querySelector(".graph g.queue")).toBeNull();
  expect(root.querySelector(".graph")?.textContent).not.toMatch(/\b0 waiting/);
});

test("waiting items show a count and pills in order", () => {
  const root = mount(["d", "e", "f"]);
  expect(root.querySelector(".graph .queue-count")?.textContent).toBe("3 waiting");
  expect(items(root)).toEqual(["d", "e", "f"]);
  expect(root.querySelector(".graph g.queue")?.getAttribute("aria-label")).toBe(
    "3 waiting, first goes next: d, e, f",
  );
  expect(root.querySelector(".graph g.queue > title")?.textContent).toBe("d, e, f");
});

test("array order is kept, not sorted", () => {
  expect(items(mount(["item10", "item2"]))).toEqual(["item10", "item2"]);
});

test("too many items: the header counts all, +N counts the rest", () => {
  const waiting = Array.from({ length: 30 }, (_, n) => `abcdefghij${n}`);
  const root = mount(waiting);
  expect(root.querySelector(".graph .queue-count")?.textContent).toBe("30 waiting");
  const shown = items(root).length;
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(30);
  expect(root.querySelector(".graph .queue-more")?.textContent).toBe(`+${30 - shown}`);
  expect(root.querySelector(".graph .queued-item text")?.textContent).toBe("abcdefg…");
});

test("worker chips are unaffected by the queue", () => {
  const children = ["w1", "w2", "w3"].map((key) => ({
    map: "workers",
    key,
    state: "workers.working",
    since: 0,
  }));
  const root = mount(["a", "b", "c", "d", "e"], children, "workersBusy");
  expect(root.querySelectorAll(".graph g.child-marker")).toHaveLength(3);
  expect(
    root.querySelector(".graph g.queue .child-marker, .graph g.queue .marker-count"),
  ).toBeNull();
});

test("a state with no row for the queue draws none", () => {
  expect(mount(["a"], [], "nowhere").querySelector(".graph g.queue")).toBeNull();
});
