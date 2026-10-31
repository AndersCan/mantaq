import { expect, test } from "vite-plus/test";
import { HEADER, machine, run, squash } from "./fixture.ts";

test("marks a non-literal target as unresolved", () => {
  const out = run(
    machine(`    const dynamic = state(String(1))();
    m.on(idle, { eventRef: go, handler: () => ({ state: dynamic }) });`),
  );
  expect(out).toContain("/* codemod: unresolved <non-literal state> */");
});

test("marks a target bound only inside the handler as unresolved", () => {
  const text = `${HEADER}import type { ActorBuilder } from "@mantaq/core";
export function setup(m: ActorBuilder<[typeof idle, typeof busy], [typeof go], [], [], unknown>) {
  m.on(idle, { eventRef: go, handler: () => { const next = busy; return { state: next }; } });
}
`;
  expect(squash(run(text))).toContain("to:[/*codemod:unresolvedbusy*/]");
});
