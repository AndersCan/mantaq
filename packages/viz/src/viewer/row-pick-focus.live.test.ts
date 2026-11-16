// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizLiveChild,
  VizLiveState,
  VizMachine,
  VizState,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, initial = false): VizState {
  return {
    id,
    label: id.slice(id.lastIndexOf(".") + 1),
    region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
    initial,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

const edge: VizEdge = {
  id: "photos.sendingPhoto-uploadConfirmed-photos.photoSent",
  from: "photos.sendingPhoto",
  event: "uploadConfirmed",
  to: "photos.photoSent",
  kind: "transition",
  origin: "declared",
  emits: [],
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
};

const machine: VizMachine = {
  id: "photoQueue",
  initial: "showingQueue",
  regions: ["photos"],
  maps: ["photos"],
  actors: [],
  states: [
    state("showingQueue", true),
    state("photos.sendingPhoto", true),
    state("photos.photoSent"),
  ],
  events: [{ id: "uploadConfirmed", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [edge],
  runs: [],
  fuzz: null,
};

function mount(keys: string[]) {
  const children: VizLiveChild[] = keys.map((key) => ({
    map: "photos",
    key,
    state: "photos.sendingPhoto",
    since: 0,
  }));
  const live = (): VizLiveState => ({
    state: "showingQueue",
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    regions: {},
    children,
    effectMode: "real",
    waiting: [],
  });
  const driver: VizDriver = { reset: live, step: live };
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  return root;
}

const row = (root: HTMLElement, key: string) =>
  [...root.querySelectorAll<HTMLElement>("li.explore-child")].find(
    (each) => each.getAttribute("data-child-key") === key,
  );

describe("row pick focus", () => {
  test("a row click keeps focus on the (rebuilt) row", () => {
    const root = mount(["p1", "p2"]);
    row(root, "p2")?.click();
    expect(document.activeElement).toBe(row(root, "p2"));
  });

  test("a chip click leaves focus on the chip", () => {
    const root = mount(["p1", "p2"]);
    const chip = root.querySelector<SVGGElement>('.graph g.child-marker[data-marker-key="p2"]');
    chip?.focus();
    chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement).toBe(
      root.querySelector('.graph g.child-marker[data-marker-key="p2"]'),
    );
  });

  test("a key with a quote can be picked from its row", () => {
    const root = mount(['a"b']);
    expect(() => row(root, 'a"b')?.click()).not.toThrow();
    expect(document.activeElement).toBe(row(root, 'a"b'));
  });
});
