// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizLiveState, VizMachine, VizState } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { expect, test } from "vite-plus/test";

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

const machine: VizMachine = {
  id: "photoQueue",
  initial: "showingQueue",
  regions: ["photos"],
  maps: ["photos"],
  actors: [],
  states: [state("showingQueue", true), state("photos.sendingPhoto", true)],
  events: [
    {
      id: "photoAdded",
      internal: false,
      doc: null,
      payload: [
        {
          name: "photoId",
          type: "string",
          optional: false,
          doc: null,
          input: "text",
          choices: [],
          sample: "p1",
        },
      ],
    },
  ],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [
    {
      id: "showingQueue-photoAdded-showingQueue",
      from: "showingQueue",
      event: "photoAdded",
      to: "showingQueue",
      kind: "stay",
      origin: "declared",
      emits: [],
      contexts: [],
      explanation: null,
      doc: null,
      coverage: null,
      tested: null,
    },
  ],
  runs: [],
  fuzz: null,
};

test("after p1 started a child, the send form shows p2, the key Send sends", () => {
  const live = (): VizLiveState => ({
    state: "showingQueue",
    steps: [{ kind: "event", event: "photoAdded", payload: { photoId: "p1" } }],
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    regions: {},
    children: [{ map: "photos", key: "p1", state: "photos.sendingPhoto", since: 1 }],
    effectMode: "real",
    waiting: [],
  });
  const driver: VizDriver = { reset: live, step: live };
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  root
    .querySelector('[data-details-edge="showingQueue-photoAdded-showingQueue"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(
    root.querySelector<HTMLInputElement>('[data-send-form] [data-value="photoId"]')?.value,
  ).toBe("p2");
});
