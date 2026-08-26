import { events } from "./event.ts";
import type { EventRef } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function typesOf(record: Record<string, EventRef<string>>) {
  return Object.fromEntries(Object.entries(record).map(([name, ref]) => [name, ref.type]));
}

describe("events", () => {
  test("creates multiple event refs keyed by the given names", () => {
    const refs = events("click", "submit", "cancel");
    expect(typesOf(refs)).toEqual({ click: "click", submit: "submit", cancel: "cancel" });
    expect(refs.click.is(refs.click.create())).toBe(true);
  });

  test("returns empty record for no names", () => {
    const refs = events();
    expect(refs).toEqual({});
  });

  test("creates distinct refs for each name", () => {
    const refs = events("a", "b");
    expect(refs.a).not.toBe(refs.b);
  });

  test("creates sendable payloads from returned refs", () => {
    const refs = events("click");
    const payload = refs.click.create(undefined);
    expect(payload).toEqual({ type: "click" });
  });

  test("returns true from is() only for refs it created", () => {
    const refs = events("a", "b");
    const eventA = refs.a.create(undefined);
    const eventB = refs.b.create(undefined);
    expect(refs.a.is(eventA)).toBe(true);
    expect(refs.a.is(eventB)).toBe(false);
  });

  test("creates a working ref from a single name", () => {
    const refs = events("tick");
    expect(typesOf(refs)).toEqual({ tick: "tick" });
    expect(refs.tick.is(refs.tick.create())).toBe(true);
  });
});
