import { expect, test, describe } from "vite-plus/test";
import { events } from "../src/event.ts";
import { EventRef } from "@mantaq/core";

describe("events", () => {
  test("creates multiple event refs from names", () => {
    const e = events("click", "submit", "cancel");
    expect(e.click).toBeInstanceOf(EventRef);
    expect(e.click.id).toBe("click");
    expect(e.submit.id).toBe("submit");
    expect(e.cancel.id).toBe("cancel");
  });

  test("returns empty object for no names", () => {
    const e = events();
    expect(e).toEqual({});
  });

  test("each event ref is distinct", () => {
    const e = events("a", "b");
    expect(e.a).not.toBe(e.b);
  });
});
