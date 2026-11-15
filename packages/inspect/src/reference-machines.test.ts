import { VirtualClock } from "@mantaq/core";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createTeamInbox } from "./fixtures/pool.ts";
import { toViz } from "./structure.ts";
import { expect, test } from "vite-plus/test";

const folder = new URL("../../viz/src/viewer/reference/", import.meta.url).pathname;

function json(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

test("writes the teamInbox machine the layout checks read", async () => {
  const made = createTeamInbox({ clock: VirtualClock() });
  const viz = toViz([{ id: "teamInbox", actor: made.actor, made }]);
  await expect(json(viz.machines[0])).toMatchFileSnapshot(`${folder}team-inbox.json`);
});

test("writes the checkout machine the layout checks read", async () => {
  const viz = toViz([{ id: "checkout", actor: createCheckoutActor() }]);
  await expect(json(viz.machines[0])).toMatchFileSnapshot(`${folder}checkout.json`);
});
