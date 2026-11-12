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
  expect(pool.actor.state.name).toBe("workWaiting");
  const working = pool.workers
    .keys()
    .filter((id) => pool.workers.get(id)?.state.name === "working");
  expect(working).toEqual(["w1", "w2", "w3"]);
});

test("A worker runs an item for one second on the pool's clock", async () => {
  const clock = VirtualClock();
  const pool = createTeamInbox({ clock });
  pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
  await pool.actor.settled();
  expect(pool.workers.get("w1")?.state.name).toBe("working");
  clock.advance(999);
  await pool.actor.settled();
  expect(pool.workers.get("w1")?.state.name).toBe("working");
  clock.advance(1);
  await pool.actor.settled();
  expect(pool.workers.get("w1")?.state.name).toBe("free");
});

test("Disposing the workers mid-run stops the one-second wait", async () => {
  const clock = VirtualClock();
  const pool = createTeamInbox({ clock });
  pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
  await pool.actor.settled();
  expect(pool.workers.get("w1")?.state.name).toBe("working");
  pool.workers.dispose();
  expect(clock.pendingTimers()).toEqual([]);
  clock.advance(1000);
  await pool.actor.settled();
  expect(pool.workers.get("w1")).toBeUndefined();
});
