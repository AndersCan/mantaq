import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

describe("Actor with RealClock (default clock)", () => {
  test("Actor uses RealClock by default when no clock provided", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: { toggled: () => ({ state: on }) },
      },
    });

    expect(actor.clock).toBeDefined();
    expect(typeof actor.clock.now()).toBe("number");
    expect(typeof actor.clock.setTimeout).toBe("function");
    expect(typeof actor.clock.clearTimeout).toBe("function");
    expect(typeof actor.clock.setInterval).toBe("function");
    expect(typeof actor.clock.clearInterval).toBe("function");
  });

  test("RealClock now() returns milliseconds since creation", () => {
    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [state("idle")()],
      initial: state("idle")(),
      effects: {},
      transitions: {},
    });

    const now = actor.clock.now();
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThan(50);
  });

  test("Actor with RealClock processes timed transitions", async () => {
    const toggle = event("toggled")();
    const done = event("done")();

    const idle = state("idle")();
    const working = state("working")();
    const complete = state("complete")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [done],
      context: {},
      states: [idle, working, complete],
      initial: idle,
      effects: {
        working: [
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(10, () => {
              emit(done.create(undefined));
            });
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: { toggled: () => ({ state: working }) },
        working: { done: () => ({ state: complete }) },
      },
    });

    actor.send(toggle);
    expect(actor.state.name).toBe("working");

    await new Promise((r) => setTimeout(r, 50));
    expect(actor.state.name).toBe("complete");
  });

  test("Actor with RealClock - effect runs on state entry", async () => {
    const toggle = event("toggled")();
    const timeout = event("timeout")();

    const idle = state("idle")();
    const active = state("active")();
    const expired = state("expired")();

    const effectRan = { value: false };

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [timeout],
      context: {},
      states: [idle, active, expired],
      initial: idle,
      effects: {
        active: [
          ({ signal, emit, clock }) => {
            effectRan.value = true;
            const id = clock.setTimeout(10, () => {
              emit(timeout.create(undefined));
            });
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: { toggled: () => ({ state: active }) },
        active: { timeout: () => ({ state: expired }) },
      },
    });

    actor.send(toggle);
    expect(effectRan.value).toBe(true);
    expect(actor.state.name).toBe("active");

    await new Promise((r) => setTimeout(r, 50));
    expect(actor.state.name).toBe("expired");
  });

  test("Actor with RealClock - timer auto-cancels on state exit", async () => {
    const toggle = event("toggled")();
    const skip = event("skip")();
    const done = event("done")();

    const idle = state("idle")();
    const working = state("working")();
    const complete = state("complete")();
    const failed = state("failed")();

    let timeoutFired = false;

    const actor = new Actor({
      inputs: [toggle, skip],
      outputs: [],
      internal: [done],
      context: {},
      states: [idle, working, complete, failed],
      initial: idle,
      effects: {
        working: [
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(50, () => {
              timeoutFired = true;
              emit(done.create(undefined));
            });
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: { toggled: () => ({ state: working }) },
        working: {
          done: () => ({ state: complete }),
          skip: () => ({ state: failed }),
        },
      },
    });

    actor.send(toggle);
    expect(actor.state.name).toBe("working");

    // Exit working state early
    actor.send(skip);
    expect(actor.state.name).toBe("failed");

    // Wait past the original timeout
    await new Promise((r) => setTimeout(r, 100));
    expect(timeoutFired).toBe(false);
    expect(actor.state.name).toBe("failed");
  });

  test("Actor with RealClock settled() resolves after async work completes", async () => {
    const toggle = event("toggled")();
    const done = event("done")();

    const idle = state("idle")();
    const working = state("working")();
    const complete = state("complete")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [done],
      context: {},
      states: [idle, working, complete],
      initial: idle,
      effects: {
        working: [
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(10, () => {
              emit(done.create(undefined));
            });
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: { toggled: () => ({ state: working }) },
        working: { done: () => ({ state: complete }) },
      },
    });

    actor.send(toggle);
    // settled() resolves when queue is empty; timer fires async so wait for it
    await new Promise((r) => setTimeout(r, 50));
    await actor.settled();
    expect(actor.state.name).toBe("complete");
  });
});

describe("RealClock vs VirtualClock behavioral difference", () => {
  test("VirtualClock advance() fires synchronously, RealClock fires asynchronously", async () => {
    const virtualClock = new VirtualClock();

    const virtualFired = { value: false };

    virtualClock.setTimeout(10, () => {
      virtualFired.value = true;
    });

    // VirtualClock: advance triggers callback synchronously
    virtualClock.advance(10);
    expect(virtualFired.value).toBe(true);

    // RealClock: callback fires asynchronously after real time
    // Verify the Actor with default clock (RealClock) fires async
    const toggle = event("toggled")();
    const done = event("done")();
    const idle = state("idle")();
    const working = state("working")();
    const complete = state("complete")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [done],
      context: {},
      states: [idle, working, complete],
      initial: idle,
      effects: {
        working: [
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(10, () => {
              emit(done.create(undefined));
            });
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: { toggled: () => ({ state: working }) },
        working: { done: () => ({ state: complete }) },
      },
    });

    actor.send(toggle);
    // Immediately after send, state is working (not complete)
    expect(actor.state.name).toBe("working");

    // After real time passes, timer fires
    await new Promise((r) => setTimeout(r, 50));
    expect(actor.state.name).toBe("complete");
  });

  test("VirtualClock requires explicit advance, RealClock uses real time", () => {
    const virtualClock = new VirtualClock();
    let virtualFired = false;
    virtualClock.setTimeout(100, () => {
      virtualFired = true;
    });

    // Without advance, VirtualClock timer never fires
    virtualClock.advance(50);
    expect(virtualFired).toBe(false);

    virtualClock.advance(50);
    expect(virtualFired).toBe(true);
  });
});
