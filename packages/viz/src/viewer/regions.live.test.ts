// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id,
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

const event = (id: string, internal = false) => ({ id, internal, doc: null, payload: null });

const photoUpload: VizMachine = {
  id: "photoUpload",
  initial: "showingUploadScreen",
  regions: ["upload", "network"],
  maps: [],
  states: [
    state("showingUploadScreen", { initial: true }),
    state("showingUploadedPhoto", { final: true }),
    state("upload.waitingForPhoto", { initial: true }),
    state("upload.sendingPhoto"),
    state("upload.photoSent", { final: true }),
    state("network.online", { initial: true }),
    state("network.offline"),
  ],
  events: [
    event("photoUploaded", true),
    event("photoPicked"),
    event("uploadConfirmed"),
    event("connectionLost"),
    event("connectionRestored"),
  ],
  outputs: [],
  context: null,
  edges: [
    edge("showingUploadScreen", "photoUploaded", "showingUploadedPhoto"),
    edge("upload.waitingForPhoto", "photoPicked", "upload.sendingPhoto"),
    edge("upload.sendingPhoto", "uploadConfirmed", "upload.photoSent"),
    edge("network.online", "connectionLost", "network.offline"),
    edge("network.offline", "connectionRestored", "network.online"),
  ],
  runs: [],
  fuzz: null,
};

function snapshot(steps: VizStep[]): VizLiveState {
  const regions = { upload: "upload.waitingForPhoto", network: "network.online" };
  let root = "showingUploadScreen";
  for (const step of steps) {
    if (step.kind !== "event" || step.actor === undefined || !("region" in step.actor)) continue;
    const at = step.actor.region === "upload" ? "upload" : "network";
    if (step.event === "photoPicked") regions.upload = "upload.sendingPhoto";
    if (step.event === "uploadConfirmed") {
      regions.upload = "upload.photoSent";
      root = "showingUploadedPhoto";
    }
    if (step.event === "connectionLost" && at === "network") regions.network = "network.offline";
  }
  const last = steps.at(-1);
  return {
    state: root,
    steps,
    last:
      last === undefined || last.kind !== "event"
        ? null
        : {
            from: "upload.waitingForPhoto",
            event: last.event,
            to: "upload.sendingPhoto",
            outcome:
              last.actor !== undefined && "region" in last.actor && last.actor.region === "nope"
                ? "missing"
                : "transition",
            effects: [],
            context: null,
            error: null,
            ...(last.actor === undefined ? {} : { actor: last.actor }),
          },
    after: [],
    timers: [],
    context: null,
    payload: null,
    regions,
    children: [],
    effectMode: "real",
    waiting: [],
  };
}

function mount(machine: VizMachine = photoUpload) {
  const root = document.createElement("div");
  const sent: VizStep[] = [];
  const driver: VizDriver = {
    reset: () => {
      sent.length = 0;
      return snapshot([]);
    },
    step: (step) => {
      sent.push(step);
      return snapshot([...sent]);
    },
  };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  return { root, sent };
}

describe("live regions", () => {
  test("each region gets a line with its own state", () => {
    const { root } = mount();
    const line = root.querySelector('p[data-region="upload"]');
    expect(line?.getAttribute("data-region-state")).toBe("upload.waitingForPhoto");
    expect(line?.textContent).toBe("upload: in waitingForPhoto");
    expect(root.querySelector('p[data-region="network"]')?.textContent).toBe("network: in online");
  });

  test("a region's events are buttons under that region only", () => {
    const { root } = mount();
    expect(root.querySelector('[data-actor=""] [data-send="photoPicked"]')).toBeNull();
    expect(root.querySelector('[data-actor="upload"] [data-send="photoPicked"]')).not.toBeNull();
    expect(root.querySelector('[data-actor="upload"] [data-send="connectionLost"]')).toBeNull();
    expect(
      root.querySelector('[data-actor="network"] [data-send="connectionLost"]'),
    ).not.toBeNull();
  });

  test("clicking a region's button sends to that region", () => {
    const { root, sent } = mount();
    root
      .querySelector<HTMLButtonElement>('[data-actor="network"] [data-send="connectionLost"]')
      ?.click();
    expect(sent).toEqual([
      { kind: "event", event: "connectionLost", payload: null, actor: { region: "network" } },
    ]);
    expect(root.querySelector('p[data-region="network"]')?.textContent).toBe("network: in offline");
  });

  test("a region step reads with local state names", () => {
    const { root } = mount();
    root
      .querySelector<HTMLButtonElement>('[data-actor="upload"] [data-send="photoPicked"]')
      ?.click();
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "photoPicked: upload: waitingForPhoto → sendingPhoto",
    );
  });

  test("a missing region says so", () => {
    const { root } = mount();
    root.querySelector<HTMLButtonElement>('[data-actor="upload"] [data-send="photoPicked"]');
    const text = "nope>photoPicked";
    const live = mountWithSteps([text]);
    expect(live.querySelector("[data-live-outcome]")?.textContent).toBe(
      "No region nope in this machine. Nothing ran.",
    );
  });

  test("every current state is marked on the diagram", () => {
    const { root } = mount();
    const current = [...root.querySelectorAll(".graph g.current")].map((each) =>
      each.getAttribute("data-node-id"),
    );
    expect(current.sort()).toEqual([
      "network.online",
      "showingUploadScreen",
      "upload.waitingForPhoto",
    ]);
  });

  test("the diagram has an entry arrow for the machine and each region", () => {
    const { root } = mount();
    expect(root.querySelectorAll(".graph .entry")).toHaveLength(3);
  });

  test("a final root still shows the regions' buttons", () => {
    const { root } = mount();
    root
      .querySelector<HTMLButtonElement>('[data-actor="upload"] [data-send="uploadConfirmed"]')
      ?.click();
    expect(root.querySelector('[data-actor=""]')).toBeNull();
    expect(root.querySelector(".explore-done")).not.toBeNull();
    expect(
      root.querySelector('[data-actor="network"] [data-send="connectionLost"]'),
    ).not.toBeNull();
    expect(root.querySelector('[data-region-final="upload"]')?.textContent).toBe(
      "upload is final: it takes no more events.",
    );
  });
});

function mountWithSteps(steps: string[]): HTMLElement {
  const root = document.createElement("div");
  const sent: VizStep[] = [];
  const driver: VizDriver = {
    reset: () => {
      sent.length = 0;
      return snapshot([]);
    },
    step: (step) => {
      sent.push(step);
      return snapshot([...sent]);
    },
  };
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [photoUpload] },
    { driver, steps },
  );
  return root;
}
