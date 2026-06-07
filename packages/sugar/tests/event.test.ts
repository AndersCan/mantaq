import { expect, test, describe } from "vite-plus/test";
import { events } from "../src/event.ts";
import { EventRef } from "@mantaq/core";

describe("events", () => {
  test("creates refs for given names", () => {
    const e = events("load", "save", "delete");
    expect(e.load).toBeInstanceOf(EventRef);
    expect(e.load.id).toBe("load");
    expect(e.save.id).toBe("save");
    expect(e.delete.id).toBe("delete");
  });

  test("returns empty object for no names", () => {
    const e = events();
    expect(e).toEqual({});
  });

  test("each ref is independent", () => {
    const e = events("x", "y");
    expect(e.x).not.toBe(e.y);
  });
});
