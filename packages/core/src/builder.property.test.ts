import { event } from "./event.ts";
import { Actor } from "./index.ts";
import type { AnyStateRef } from "./index.ts";
import { state } from "./state.ts";
import { anyName, fc, runProperty } from "@mantaq/pbt";
import { describe, expect, test } from "vite-plus/test";

describe("ActorBuilder property tests", () => {
  test("targets records every declared `to` name, in order; no `to` records none", () => {
    runProperty(
      fc
        .uniqueArray(anyName, { minLength: 1, maxLength: 6 })
        .chain((names) =>
          fc.tuple(
            fc.constant(names),
            fc.subarray(names),
            fc.option(fc.subarray(names), { nil: undefined }),
          ),
        ),
      ([names, onTargets, anyTargets]) => {
        const refs: AnyStateRef[] = names.map((name) => state(name)());
        const byName = (picked: string[]) =>
          picked.flatMap((name) => refs.filter((ref) => ref.name === name));
        const go = event("GO")();
        const first = refs[0] ?? state("fallback")();
        const actor = Actor({
          inputs: [go],
          states: refs,
          initial: first,
          setup: (m) => {
            m.on(first, { event: go, to: byName(onTargets), handler: () => ({}) });
            m.onAny({ event: go, to: anyTargets && byName(anyTargets), handler: () => ({}) });
          },
        });
        expect(actor.options.targets).toEqual({
          [first.name]: { GO: onTargets },
          Any: { GO: anyTargets ?? [] },
        });
      },
    );
  });
});
