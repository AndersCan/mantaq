import { expect, test, describe } from "vite-plus/test";
import { event, EventRef } from "../src/event.ts";

describe("EventRef", () => {
  test("is — returns falsy when anyEvent is falsy", () => {
    const toggled = event("toggled")();
    expect(toggled.is(null as any)).toBeFalsy();
    expect(toggled.is(undefined as any)).toBeFalsy();
  });

  test("is — returns true when ids match", () => {
    const toggled = event("toggled")();
    const created = toggled.create(undefined);
    expect(toggled.is(created as any)).toBe(true);
  });

  test("is — returns false when ids differ", () => {
    const toggled = event("toggled")();
    const other = event("other")();
    const created = other.create(undefined);
    expect(toggled.is(created as any)).toBe(false);
  });

  test("create — merges payload with id", () => {
    const clicked = event("clicked")<{ x: number; y: number }>();
    const result = clicked.create({ x: 10, y: 20 });
    expect(result).toEqual({ x: 10, y: 20, id: "clicked" });
  });

  test("constructor sets id", () => {
    const ref = new EventRef("myEvent");
    expect(ref.id).toBe("myEvent");
    expect(ref.payload).toBeUndefined();
  });
});
