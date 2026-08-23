import { expect, test, describe } from "vite-plus/test";
import { Actor, state, event } from "../src/index.ts";

const idle = state("idle")();
const active = state("active")();
const go = event("GO")();

describe("ActorBuilder duplicate registration", () => {
  test("duplicate on(state, event) throws", () => {
    expect(
      () =>
        new Actor({
          inputs: [go],
          states: [idle, active],
          initial: idle,
          setup: (m) => {
            m.on(idle, go, () => ({ state: active }));
            m.on(idle, go, () => ({ state: active }));
          },
        }),
    ).toThrow(/duplicate transition handler.*idle.*GO/);
  });

  test("duplicate onAny(event) throws", () => {
    expect(
      () =>
        new Actor({
          inputs: [go],
          states: [idle, active],
          initial: idle,
          setup: (m) => {
            m.onAny(go, () => ({ state: active }));
            m.onAny(go, () => ({ state: active }));
          },
        }),
    ).toThrow(/duplicate Any-handler.*GO/);
  });

  test("composing the same part twice throws on the duplicate", () => {
    expect(
      () =>
        new Actor({
          inputs: [go],
          states: [idle, active],
          initial: idle,
          setup: (m) => {
            const part = (b: typeof m): void => {
              b.on(idle, go, () => ({ state: active }));
            };
            part(m);
            part(m);
          },
        }),
    ).toThrow(/duplicate transition handler/);
  });
});
