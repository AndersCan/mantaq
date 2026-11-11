// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { createPool } from "@mantaq/sugar";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { mountViewer } from "@mantaq/viz/viewer";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { toViz } from "./structure.ts";

const create = () => {
  const clock = VirtualClock();
  const made = createPool<string, "team">({
    name: "team",
    workers: 3,
    run: () => Promise.resolve(),
    clock,
  });
  return { actor: made.actor, clock, made };
};
const machine = toViz([{ id: "teamInbox", ...create() }]).machines[0]!;

test("plan #555 Try it step 5: the ITEMS_ASSIGNED arrow names the states that take it", () => {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver: createDriver({ id: "teamInbox", create }) },
  );
  root.querySelector('g.link[data-event="team.ITEMS_ASSIGNED"]')?.dispatchEvent(new Event("click"));
  expect(root.querySelector("[data-link-sender]")?.textContent).toBe(
    "teamInbox sends team.ITEMS_ASSIGNED. On: team.ITEM_ARRIVED.",
  );
  expect(root.querySelector("[data-link-receiver]")?.textContent).toBe(
    "workers take it in: free, working.",
  );
});
