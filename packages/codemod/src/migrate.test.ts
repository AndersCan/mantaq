import { describe, expect, test } from "vite-plus/test";
import { HEADER, machine, run, squash } from "./fixture.ts";
import { eventKey } from "./transforms/event-key.ts";

describe("event-key", () => {
  test("renames eventRef on builder calls", () => {
    const out = run(
      machine(`    m.on(idle, { eventRef: go, handler: () => ({}) });
    m.onAny({ eventRef: stop, handler: () => ({}) });`),
      [eventKey],
    );
    expect(squash(out)).toContain("m.on(idle,{event:go,handler:()=>({})})");
    expect(squash(out)).toContain("m.onAny({event:stop,handler:()=>({})})");
  });

  test("keeps the binding of a shorthand eventRef", () => {
    const out = run(
      machine(`    const eventRef = go;
    m.on(idle, { eventRef, handler: () => ({}) });`),
      [eventKey],
    );
    expect(squash(out)).toContain("{event:eventRef,handler");
  });

  test("sees through type aliases of the builder", () => {
    const text = `${HEADER}import type { ActorBuilder } from "@mantaq/core";
type Builder = ActorBuilder<[typeof idle], [typeof go], [], [], unknown>;
export function part(m: Builder) {
  m.on(idle, { eventRef: go, handler: () => ({}) });
}
`;
    expect(squash(run(text, [eventKey]))).toContain("{event:go,handler");
  });

  test("leaves unrelated eventRef keys alone", () => {
    const text = `${HEADER}export const config = { on: (x: object) => x };
config.on({ eventRef: go });
`;
    expect(run(text, [eventKey])).toBe(text);
  });
});

describe("declare-targets", () => {
  test("lists the single returned state", () => {
    const out = run(machine(`    m.on(idle, { eventRef: go, handler: () => ({ state: busy }) });`));
    expect(squash(out)).toContain("{event:go,to:[busy],handler");
  });

  test("lists every branch in declaration order", () => {
    const out = run(
      machine(`    m.on(busy, {
      eventRef: go,
      handler: (_e, { context }) => {
        if (context.get().n > 1) return { state: done };
        return Math.max(1, 2) > 1 ? { state: idle } : {};
      },
    });`).replace("initial: idle,", "initial: idle,\n  context: { n: 0 },"),
    );
    expect(squash(out)).toContain("to:[idle,done]");
  });

  test("reads the nested { state, payload } form", () => {
    const out = run(
      machine(`    m.on(idle, { eventRef: go, handler: () => ({ state: { state: busy } }) });`),
    );
    expect(squash(out)).toContain("to:[busy]");
  });

  test("follows a handler declared elsewhere", () => {
    const out = run(
      machine(`    const back = () => ({ state: idle });
    m.on(busy, { eventRef: stop, handler: back });
    m.onAny({ eventRef: go, handler: back });`),
    );
    expect(squash(out)).toContain("m.on(busy,{event:stop,to:[idle],handler:back})");
    expect(squash(out)).toContain("m.onAny({event:go,to:[idle],handler:back})");
  });

  test("resolves states declared in a variable", () => {
    const text = machine(
      `    m.on(idle, { eventRef: go, handler: () => ({ state: done }) });`,
      "all",
    ).replace("export const actor", "const all = [idle, busy, done];\nexport const actor");
    expect(squash(run(text))).toContain("to:[done]");
  });

  test("reuses returned expressions when no states array is in reach", () => {
    const text = `${HEADER}import type { ActorBuilder } from "@mantaq/core";
export function part(m: ActorBuilder<[typeof idle, typeof busy], [typeof go], [], [], unknown>) {
  m.on(idle, { eventRef: go, handler: () => ({ state: busy }) });
}
`;
    expect(squash(run(text))).toContain("to:[busy]");
  });

  test("adds nothing to a handler that only stays", () => {
    const out = run(machine(`    m.on(idle, { eventRef: go, handler: () => ({}) });`));
    expect(squash(out)).toContain("{event:go,handler");
    expect(out).not.toContain("to:");
  });

  test("is idempotent", () => {
    const once = run(
      machine(`    m.on(idle, { eventRef: go, handler: () => ({ state: busy }) });`),
    );
    expect(run(once)).toBe(once);
  });
});
