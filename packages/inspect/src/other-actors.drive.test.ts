import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { execute } from "./fuzz/run.ts";
import { normalizeRun } from "./runs.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { withTimeout } from "@mantaq/sugar";

const idle = state("idle")();
const waiting = state("waiting")();
const timedOut = state("timedOut")();
const start = event("start")();
const expired = event("expired")();

/** A checkout with a second machine returned next to it: waits 800 ms after `start`. */
const clocks: ReturnType<typeof VirtualClock>[] = [];

function create() {
  const clock = VirtualClock();
  clocks.push(clock);
  const timer = Actor({
    inputs: [start],
    internal: [expired],
    states: [idle, waiting, timedOut],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: start, to: [waiting], handler: () => ({ state: waiting }) });
      m.effect(waiting, {
        name: "deadline",
        sends: [expired],
        fn: (input) => withTimeout(800, { input, event: () => expired.create() }),
      });
      m.on(waiting, { event: expired, to: [timedOut], handler: () => ({ state: timedOut }) });
    },
  });
  return {
    actor: createCheckoutActor(clock),
    clock,
    made: { actor: createCheckoutActor(clock), timer },
  };
}

const startTimer = {
  kind: "event",
  event: "start",
  payload: null,
  actor: { region: "timer" },
} as const;

test("a returned machine's effect is held until the viewer says what it reports", () => {
  const driver = createDriver({ id: "x", create }, { effectMode: "held" });
  const live = driver.step(startTimer);
  expect(live.regions["timer"]).toBe("timer.waiting");
  expect(live.waiting).toEqual(["deadline"]);
  expect(live.last).toMatchObject({
    from: "timer.idle",
    to: "timer.waiting",
    actor: { region: "timer" },
  });
});

test("with real effects its timer runs on the shared clock and the move is logged under its name", async () => {
  const driver = createDriver({ id: "x", create }, { effectMode: "real" });
  driver.step(startTimer);
  const live = driver.step({ kind: "advance", ms: 800 });
  expect(live.timers).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(driver.step({ kind: "advance", ms: 0 }).regions["timer"]).toBe("timer.timedOut");
});

test("a step naming a part that does not exist is logged as missing", () => {
  const driver = createDriver({ id: "x", create });
  const live = driver.step({ ...startTimer, actor: { region: "nobody" } });
  expect(live.last).toMatchObject({ outcome: "missing" });
});

test("a dry run on a copy replays the walk with the returned machine in it", () => {
  const driver = createDriver({ id: "x", create }, { effectMode: "real" });
  driver.step(startTimer);
  expect(driver.dryRun?.([startTimer])[0]).toMatchObject({
    outcome: "ignored",
    from: "timer.waiting",
  });
});

const pending = () => clocks.map((clock) => clock.pendingTimers().length);

test("fuzzing a run disposes the returned machine, so its timer is gone", () => {
  clocks.length = 0;
  execute({ id: "x", create }, [startTimer]);
  expect(pending()).toEqual([0]);
});

test("replaying a recorded run disposes the returned machine", () => {
  clocks.length = 0;
  normalizeRun(
    { id: "x", create },
    { name: "r", steps: [startTimer], end: createCheckoutActor().state.name },
  );
  expect(pending()).toEqual([0]);
});

test("reset and a dry run dispose the machines they leave behind", () => {
  clocks.length = 0;
  const driver = createDriver({ id: "x", create }, { effectMode: "real" });
  driver.step(startTimer);
  driver.dryRun?.([startTimer]);
  expect(pending()).toEqual([1, 0]);
  driver.reset();
  expect(pending()).toEqual([0, 0, 0]);
});
