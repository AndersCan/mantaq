import { expect, test, describe } from "vite-plus/test";
import { events } from "../src/event.ts";
import { EventRef } from "@mantaq/core";

describe("events", () => {
  test("creates EventRef objects for each name", () => {
    const e = events("load", "success", "error");
    expect(e.load).toBeInstanceOf(EventRef);
    expect(e.success).toBeInstanceOf(EventRef);
    expect(e.error).toBeInstanceOf(EventRef);
  });

  test("creates EventRef with correct ids", () => {
    const e = events("toggle", "submit");
    expect(e.toggle.id).toBe("toggle");
    expect(e.submit.id).toBe("submit");
  });

  test("returns record keyed by event id", () => {
    const e = events("x", "y");
    expect(Object.keys(e)).toEqual(["x", "y"]);
  });

  test("empty — no names returns empty record", () => {
    const e = events();
    expect(Object.keys(e)).toEqual([]);
  });

  test("single name", () => {
    const e = events("only");
    expect(e.only.id).toBe("only");
  });
});
