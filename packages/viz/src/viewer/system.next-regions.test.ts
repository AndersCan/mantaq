// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

const state = (id: string, initial = false): VizState => ({
  id,
  label: id.slice(id.lastIndexOf(".") + 1),
  region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const edge = (from: string, event: string, to: string, emits: string[] = []): VizEdge => ({
  id: `${from}-${event}-${to}`,
  from,
  event,
  to,
  kind: "transition",
  origin: "declared",
  emits,
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
});

const event = (id: string) => ({ id, internal: false, doc: null, payload: null });

/** A root and one plain region; the region takes PICK only while waiting, CONFIRM only while sending. */
const upload: VizMachine = {
  id: "photo",
  initial: "screen",
  regions: ["upload"],
  maps: [],
  actors: [],
  states: [
    state("screen", true),
    state("done"),
    state("upload.waiting", true),
    state("upload.sending"),
  ],
  events: [event("PICK"), event("CONFIRM"), event("UPLOADED"), event("RESET")],
  outputs: [],
  partOutputs: { upload: ["UPLOADED"] },
  context: null,
  edges: [
    edge("screen", "UPLOADED", "done"),
    edge("done", "RESET", "screen"),
    edge("upload.waiting", "PICK", "upload.sending"),
    edge("upload.sending", "CONFIRM", "upload.waiting", ["UPLOADED"]),
    edge("upload.*", "RESET", "upload.waiting"),
  ],
  runs: [],
  fuzz: null,
};

function live(root: string, region: string): VizLiveState {
  return {
    state: root,
    regions: { upload: region },
    children: [],
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    effectMode: "real",
    waiting: [],
  };
}

function mount(machine: VizMachine = upload) {
  const root = document.createElement("div");
  const driver: VizDriver = {
    reset: () => live("screen", "upload.waiting"),
    step: () => live("screen", "upload.sending"),
  };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  return root;
}

const arrowTo = (root: HTMLElement, part: string) =>
  root.querySelector(`g.link-in[data-to="${part}"]`);
const pinkText = (root: HTMLElement) =>
  [...root.querySelectorAll("g.link-in.next text, g.link-in .next text")].map(
    (each) => each.textContent,
  );

describe("system view entry arrow, regions", () => {
  test("a region's arrow moves from the region's own state, not the root's", () => {
    const noAny = { ...upload, edges: upload.edges.filter((each) => each.from !== "upload.*") };
    expect(pinkText(mount(noAny))).toContain("PICK");
  });

  test("a region's any-state edge does not move the root's arrow", () => {
    expect(arrowTo(mount(), "")?.querySelector(".next")).toBeNull();
  });

  test("only the events the current state takes are pink", () => {
    const root = mount();
    expect(pinkText(root)).toEqual(["PICK", "RESET"]);
    root.querySelector<HTMLButtonElement>('[data-send="PICK"]')?.click();
    expect(pinkText(root)).toEqual(["CONFIRM", "RESET"]);
  });
});
