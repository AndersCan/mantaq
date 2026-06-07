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

  test("create on returned refs works", () => {
    const e = events("click");
    const payload = e.click.create(undefined);
    expect(payload).toEqual({ id: "click" });
  });

  test("is method works on returned refs", () => {
    const e = events("a", "b");
    const eventA = e.a.create(undefined);
    const eventB = e.b.create(undefined);
    expect(e.a.is(eventA)).toBe(true);
    expect(e.a.is(eventB)).toBe(false);
  });

  test("single event", () => {
    const e = events("tick");
    expect(e.tick).toBeInstanceOf(EventRef);
    expect(e.tick.id).toBe("tick");
  });
});
