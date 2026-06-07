import { expect, test, describe } from "vite-plus/test";
import { events } from "../src/event.ts";
import { EventRef } from "@mantaq/core";

describe("events", () => {
  test("creates multiple event refs", () => {
    const e = events("load", "cancel", "retry");
    expect(e.load).toBeInstanceOf(EventRef);
    expect(e.cancel).toBeInstanceOf(EventRef);
    expect(e.retry).toBeInstanceOf(EventRef);
    expect(e.load.id).toBe("load");
    expect(e.cancel.id).toBe("cancel");
    expect(e.retry.id).toBe("retry");
  });

  test("single event", () => {
    const e = events("tick");
    expect(e.tick).toBeInstanceOf(EventRef);
    expect(e.tick.id).toBe("tick");
  });

  test("events are independent refs", () => {
    const e = events("a", "b");
    expect(e.a).not.toBe(e.b);
  });
});
