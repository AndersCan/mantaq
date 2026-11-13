// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { createPool } from "@mantaq/sugar";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { mountViewer } from "@mantaq/viz/viewer";
import { expect, test } from "vite-plus/test";
import { createPhotoUploadActor } from "../../../apps/docs/src/content/docs/photo-upload.ts";
import { createDriver } from "./drive.ts";
import { toViz } from "./structure.ts";

test("the network part, drawn alone, takes connectionLost from its panel", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: createPhotoUploadActor({ clock }), clock };
  };
  const machine = toViz([{ id: "photoUpload", ...create() }]).machines[0]!;
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver: createDriver({ id: "photoUpload", create }) },
  );
  expect(root.querySelector('[data-entry-event="connectionLost"]')).toBeNull();
  root.querySelector('g[data-part="network"]')?.dispatchEvent(new Event("click"));
  const send = root.querySelector('[data-send="connectionLost"]');
  expect(send).not.toBeNull();
  send?.dispatchEvent(new Event("click"));
  expect(root.querySelector('g[data-part="network"] .part-chip')?.textContent).toBe("offline");
});

test("the pool pill sends team.ITEM_ARRIVED to the root and a worker starts", () => {
  const create = () => {
    const clock = VirtualClock();
    const made = createPool<string, "team">({
      name: "team",
      workers: 3,
      run: () => new Promise(() => {}),
      clock,
    });
    return { actor: made.actor, clock, made };
  };
  const machine = toViz([{ id: "teamInbox", ...create() }]).machines[0]!;
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver: createDriver({ id: "teamInbox", create }) },
  );
  root.querySelector('[data-entry-event="team.ITEM_ARRIVED"]')?.dispatchEvent(new Event("click"));
  const dots = [...root.querySelectorAll('g[data-part="workers"] g.child-dot')].map(
    (dot) => `${dot.getAttribute("data-child")}:${dot.getAttribute("data-state")}`,
  );
  expect(dots).toEqual(["w1:working", "w2:free", "w3:free"]);
});
