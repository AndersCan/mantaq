import { expect, test } from "vite-plus/test";
import { Any, RealClock } from "../src/index.ts";
import type { EffectFn, EffectInput } from "../src/index.ts";

test("Any constant", () => {
  expect(Any).toBe("Any");
});

export type _EffectFnCheck = EffectFn<[], [], unknown>;
export type _EffectInputCheck = EffectInput<[], [], unknown>;
export type _RealClockCheck = typeof RealClock;
