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

test("a pool is drawn as one diagram, with no system board", () => {
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
  expect(root.querySelector("svg[data-system]")).toBeNull();
  expect(root.querySelector('.graph g.region[data-map="workers"]')).not.toBeNull();
});
