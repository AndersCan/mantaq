// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { mountViewer } from "@mantaq/viz/viewer";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createTeamInbox } from "./fixtures/pool.ts";
import { toViz } from "./structure.ts";

const create = () => {
  const clock = VirtualClock();
  const made = createTeamInbox({ clock });
  return { actor: made.actor, clock, made };
};
const machine = toViz([{ id: "teamInbox", ...create() }]).machines[0]!;
const pathTexts = (root: HTMLElement) =>
  [...root.querySelectorAll("[data-rewind]")].map((b) => b.textContent);

test("pool: a replayed link names w1 then w2 on the Path", async () => {
  const steps = ['team.ITEM_ARRIVED={"item":"a"}', 'team.ITEM_ARRIVED={"item":"b"}'];
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver: createDriver({ id: "teamInbox", create }), steps },
  );
  const first = pathTexts(root);
  await new Promise((r) => setTimeout(r, 20));
  expect(first[1]).toContain("then w1: free → working");
  expect(first[2]).toContain("then w2: free → working");
});

test("pool, real effects: a late move shown on a step stays on it after the next step", async () => {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    {
      driver: createDriver({ id: "teamInbox", create }, { effectMode: "real" }),
      steps: ['team.ITEM_ARRIVED={"item":"a"}'],
    },
  );
  await new Promise((r) => setTimeout(r, 20));
  const before = pathTexts(root)[1];
  root.querySelector<HTMLButtonElement>('[data-send="team.ITEM_ARRIVED"]')?.click();
  root.querySelector<HTMLButtonElement>('[data-payload-send="team.ITEM_ARRIVED"]')?.click();
  const after = pathTexts(root);
  expect(after.length).toBe(3);
  expect(after[1]).toBe(before);
});

test("pool: w1 finishes and takes the waiting item; the Path names both moves (plan Try it step 4)", () => {
  const steps = [
    'team.ITEM_ARRIVED={"item":"a"}',
    'team.ITEM_ARRIVED={"item":"b"}',
    'team.ITEM_ARRIVED={"item":"c"}',
    "workers[w1]>team.RUN_SUCCEEDED",
  ];
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver: createDriver({ id: "teamInbox", create }), steps },
  );
  const texts = pathTexts(root);
  expect(texts).toHaveLength(5);
  expect(texts[4]).toContain("teamInbox: workWaiting → workersBusy");
  expect(texts[4]).toContain("w1: free → working");
});

test("pool: event ids containing a dot replay from a link", () => {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    {
      driver: createDriver({ id: "teamInbox", create }),
      steps: ['team.ITEM_ARRIVED={"item":"a"}'],
    },
  );
  expect(root.querySelectorAll("[data-live-cascade]")).toHaveLength(1);
  expect(pathTexts(root)[1]).toBe("team.ITEM_ARRIVED {item a}, then w1: free → working");
});
