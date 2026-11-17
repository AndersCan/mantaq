import { describe, expect, test } from "vite-plus/test";
import type { Clock } from "./index.ts";
import { Actor, VirtualClock, machine, state } from "./index.ts";

const idle = state("idle")();

// Built inside each test, not at import: Stryker's mutants only reach code that runs during a test.
function meal() {
  return machine("meal", {
    create: ({ clock, port = "real" }: { clock: Clock; port?: string }) =>
      Actor({
        clock,
        inputs: [],
        states: [idle],
        initial: idle,
        context: { port },
        setup: () => {},
      }),
  });
}

describe("machine", () => {
  test("keeps its id", () => {
    expect(meal().id).toBe("meal");
  });

  test("create builds a fresh actor each call", () => {
    const m = meal();
    expect(m.create()).not.toBe(m.create());
  });

  test("create passes a given clock through", () => {
    const clock = VirtualClock();
    expect(meal().create({ clock }).clock).toBe(clock);
  });

  test("create defaults to real time", () => {
    const now = meal().create().clock.now();
    expect(Math.abs(now - Date.now())).toBeLessThan(1000);
  });

  test("other options pass through and default", () => {
    const m = meal();
    expect(m.create().context.port).toBe("real");
    expect(m.create({ port: "fake" }).context.port).toBe("fake");
  });
});
