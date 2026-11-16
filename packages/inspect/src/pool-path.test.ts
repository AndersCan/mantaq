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
const current = (root: HTMLElement) => root.querySelector(".explore")?.getAttribute("data-current");

test("pool: w1 finishes and takes the waiting item; the diagram shows the machine busy", () => {
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
  expect(current(root)).toBe("workersBusy");
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
  expect(current(root)).toBe("workersBusy");
});
