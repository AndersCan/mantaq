import { VirtualClock } from "@mantaq/core";
import { recordRuns } from "@mantaq/inspect/record";
import { expect, test } from "vite-plus/test";
import { createTeamInbox } from "./team-inbox.ts";

const make = recordRuns(createTeamInbox);

test("Four items, three workers", async () => {
  const clock = VirtualClock();
  const pool = make({ clock });
  for (const item of ["a", "b", "c", "d"]) {
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    await pool.actor.settled();
  }
  expect(pool.actor.state.name).toBe("holding");
  const working = pool.workers
    .keys()
    .filter((id) => pool.workers.get(id)?.state.name === "working");
  expect(working).toEqual(["w1", "w2", "w3"]);
});
