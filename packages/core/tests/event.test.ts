import { expect, test, describe } from "vite-plus/test";
import { event, EventRef } from "../src/event.ts";

describe("EventRef", () => {
  test("is — returns false for null", () => {
    const toggled = event("toggled")();
    expect(toggled.is(null)).toBe(false);
  });

  test("is — returns false for undefined", () => {
    const toggled = event("toggled")();
    expect(toggled.is(undefined)).toBe(false);
  });

  test("is — returns true when ids match", () => {
    const toggled = event("toggled")();
    const created = toggled.create(undefined);
    expect(toggled.is(created)).toBe(true);
  });

  test("is — returns false when ids differ", () => {
    const toggled = event("toggled")();
    const other = event("other")();
    const created = other.create(undefined);
    expect(toggled.is(created)).toBe(false);
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

  test("create with undefined payload still has id", () => {
    const toggled = event("toggled")();
    const result = toggled.create(undefined);
    expect(result).toEqual({ id: "toggled" });
  });

  test("create with payload merges correctly", () => {
    const dataEv = event("data")<{ value: number }>();
    const result = dataEv.create({ value: 42 });
    expect(result).toEqual({ id: "data", value: 42 });
  });

  test("create with primitive number payload spreads as empty object", () => {
    const go = event("go")<number>();
    const result = go.create(42);
    expect(result.id).toBe("go");
    expect(typeof result).toBe("object");
  });

  test("create with primitive string payload spreads characters", () => {
    const select = event("select")<string>();
    const result = select.create("active");
    expect(result.id).toBe("select");
    expect(typeof result).toBe("object");
  });

  test("create with null payload wraps in value", () => {
    const toggle = event("toggle")<null>();
    const result = toggle.create(null as any);
    expect(result).toEqual({ id: "toggle", value: null });
  });
});
