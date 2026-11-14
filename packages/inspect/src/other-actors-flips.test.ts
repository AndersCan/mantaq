import { Either } from "@mantaq/utils";
import { normalizeRun } from "./runs.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { withTimeout } from "@mantaq/sugar";
import { inspect, inspectModule } from "./inspect.ts";

const idle = state("idle")();
const waiting = state("waiting")();
const timedOut = state("timedOut")();
const start = event("start")();
const expired = event("expired")();

function create() {
  const clock = VirtualClock();
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
  const actor = createCheckoutActor(clock);
  return { actor, clock, made: { actor, timer } };
}

const startTimer = {
  kind: "event",
  event: "start",
  payload: null,
  actor: { region: "timer" },
} as const;

test("a dry run refuses when the returned machine on the copy is not where the live one is", async () => {
  const driver = createDriver({ id: "x", create }, { effectMode: "real" });
  driver.step(startTimer);
  driver.step({ kind: "advance", ms: 800 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(driver.step({ kind: "advance", ms: 0 }).regions["timer"]).toBe("timer.timedOut");
  // The copy holds the deadline effect, so its timer stays in waiting: that is drift.
  expect(driver.dryRun?.([startTimer])[0]).toBeNull();
});

test("fuzz sends the returned inbox's own events: WORKERS_RESIZED gets hits", async () => {
  const file = new URL("./fixtures/kitchen.ts", import.meta.url).pathname;
  const result = await inspectModule(file, { load: (path) => import(path) });
  const machine = result.machines[0]!;
  const resized = machine.edges.filter((each) => each.event === "orders.WORKERS_RESIZED");
  expect(resized.length).toBeGreaterThan(0);
  expect(resized.some((each) => (each.coverage?.hits ?? 0) > 0)).toBe(true);
}, 60_000);

test("a returned machine's internal event is internal, so the board draws no entry for it", async () => {
  const { toViz } = await import("./structure.ts");
  const { systemOf } = await import("@mantaq/viz");
  const machine = toViz([{ id: "x", ...create() }]).machines[0]!;
  expect(machine.events.find((each) => each.id === "expired")?.internal).toBe(true);
  expect(systemOf(machine).entries).not.toContainEqual({ to: "timer", event: "expired" });
});

test("a replay sends a step to the returned machine", () => {
  const made = create();
  const target = { id: "timed", create: () => made };
  const result = normalizeRun(target, {
    name: "r",
    end: made.actor.state.name,
    steps: [{ kind: "event", event: "start", payload: {}, actor: { region: "timer" } }],
  });
  expect(Either.isRight(result)).toBe(true);
  expect(made.made.timer.state.name).toBe("waiting");
});

test("an input the returned machine declares but never handles is still an event of the machine", async () => {
  const quiet = state("quiet")();
  const ping = event("ping")();
  const part = Actor({
    inputs: [ping],
    states: [quiet],
    initial: quiet,
    clock: VirtualClock(),
    setup: () => {},
  });
  const root = createCheckoutActor();
  const result = inspect({
    id: "m",
    create: () => ({ actor: root, part }),
    fuzz: false,
  });
  expect(result.machine.events.map((each) => each.id)).toContain("ping");
});
