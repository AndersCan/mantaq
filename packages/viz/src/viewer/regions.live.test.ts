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
  actors: [],
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
  partOutputs: { upload: ["photoUploaded"] },
  context: null,
  edges: [
    edge("showingUploadScreen", "photoUploaded", "showingUploadedPhoto"),
    edge("upload.waitingForPhoto", "photoPicked", "upload.sendingPhoto"),
    {
      ...edge("upload.sendingPhoto", "uploadConfirmed", "upload.photoSent"),
      emits: ["photoUploaded"],
    },
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
            sent: [],
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
  test("a machine whose regions talk opens on its diagram, and its Send button walks a region", () => {
    const { root, sent } = mount();
    expect(root.querySelector('svg.graph g.region[data-region="upload"]')).not.toBeNull();
    expect(root.querySelector("[data-system]")).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-send="photoPicked"]')?.click();
    expect(sent).toEqual([
      { kind: "event", event: "photoPicked", payload: null, actor: { region: "upload" } },
    ]);
    expect(
      root.querySelector(".graph g.current[data-node-id='upload.sendingPhoto']"),
    ).not.toBeNull();
  });

  test("an input another part sends sits under Send an input, not in a group of its own", () => {
    const { root } = mount({
      ...photoUpload,
      events: photoUpload.events.map((each) =>
        each.id === "photoUploaded" ? { ...each, internal: false } : each,
      ),
    });
    const groups = [...root.querySelectorAll("[data-group]")].map((each) =>
      each.getAttribute("data-group"),
    );
    expect(groups).not.toContain("parts");
    expect(
      root.querySelector('[data-group="input"] [data-send-item="photoUploaded"]'),
    ).not.toBeNull();
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
    expect(root.querySelector(".graph g.current[data-node-id='network.offline']")).not.toBeNull();
  });

  test("a region arrow's Details Send sends to that region", () => {
    const { root, sent } = mount();
    root
      .querySelector('[data-edge-id="network.online-connectionLost-network.offline"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(sent).toEqual([
      { kind: "event", event: "connectionLost", payload: null, actor: { region: "network" } },
    ]);
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
    expect(root.querySelector("section.explore[data-done]")).not.toBeNull();
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

describe("the Send line", () => {
  const sentLine = (root: HTMLElement) =>
    root.querySelector(".explore-outcome")?.firstElementChild?.textContent;

  test("a root Send leads the Step tab with just the event", () => {
    const flat: VizMachine = {
      ...photoUpload,
      id: "flat",
      initial: "showingUploadScreen",
      regions: [],
      partOutputs: {},
      states: [state("showingUploadScreen", { initial: true }), state("showingUploadedPhoto")],
      events: [event("photoUploaded")],
      edges: [edge("showingUploadScreen", "photoUploaded", "showingUploadedPhoto")],
    };
    const { root } = mount(flat);
    root.querySelector<HTMLButtonElement>('[data-send="photoUploaded"]')?.click();
    expect(sentLine(root)).toBe("Sent photoUploaded");
  });

  test("a region Send names the region", () => {
    const { root } = mount();
    root
      .querySelector<HTMLButtonElement>('[data-actor="upload"] [data-send="photoPicked"]')
      ?.click();
    expect(sentLine(root)).toBe("Sent photoPicked to upload");
  });

  test("a rewind after a Send drops the line", () => {
    const { root } = mount();
    root
      .querySelector<HTMLButtonElement>('[data-actor="upload"] [data-send="photoPicked"]')
      ?.click();
    root
      .querySelector<HTMLButtonElement>('[data-actor="network"] [data-send="connectionLost"]')
      ?.click();
    expect(sentLine(root)).toBe("Sent connectionLost to network");
    root.querySelector<HTMLButtonElement>('[data-explore-action="back"]')?.click();
    expect(root.querySelector(".explore-outcome")).not.toBeNull();
    expect(root.querySelector("[data-live-sent-event]")).toBeNull();
  });
});
