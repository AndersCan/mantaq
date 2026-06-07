import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "@mantaq/core";
import { withTimeout } from "../src/effects/timeout.ts";

describe("withTimeout", () => {
  test("emits event after ms elapses", () => {
    const clock = new VirtualClock();
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);

    withTimeout(100, { signal: new AbortController().signal, emit, clock } as any, () => ({
      id: "timedOut",
    }));

    clock.advance(99);
    expect(emitted).toEqual([]);

    clock.advance(1);
    expect(emitted).toEqual([{ id: "timedOut" }]);
  });

  test("does not emit if aborted before deadline", () => {
    const clock = new VirtualClock();
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const controller = new AbortController();

    withTimeout(100, { signal: controller.signal, emit, clock } as any, () => ({
      id: "timedOut",
    }));

    controller.abort();
    clock.advance(200);
    expect(emitted).toEqual([]);
  });
});
