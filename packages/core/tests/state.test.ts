import { expect, test, describe } from "vite-plus/test";
import { state, StateRef, TransitionState } from "../src/state.ts";

test("state creates a StateRef with correct name", () => {
  const s = state("idle")();
  expect(s).toBeInstanceOf(StateRef);
  expect(s.name).toBe("idle");
});

test("state name is a string literal type", () => {
  const s = state("myState")();
  expect(typeof s.name).toBe("string");
  expect(s.name).toBe("myState");
});

test("final() marks state as final and returns self", () => {
  const s = state("done")();
  expect(s.isFinal).toBe(false);
  const result = s.final();
  expect(s.isFinal).toBe(true);
  expect(result).toBe(s);
});

test("regions() configures multiple regions and returns self", () => {
  const s = state("multi")();
  const result = s.regions({
    left: {
      initial: "a",
      states: { a: state("a")(), b: state("b")().final() },
    },
    right: {
      initial: "x",
      states: { x: state("x")(), y: state("y")().final() },
    },
  });

  expect(s._regions).toBeDefined();
  expect(Object.keys(s._regions!)).toEqual(["left", "right"]);
  expect(s._regions!.left.initial).toBe("a");
  expect(s._regions!.right.initial).toBe("x");
  expect(result).toBe(s);
});

test("chaining: final().regions() work together", () => {
  const s = state("chained")()
    .final()
    .regions({
      default: { initial: "a", states: { a: state("a")() } },
    });

  expect(s.isFinal).toBe(true);
  expect(s._regions).toBeDefined();
});

test("default values for optional properties", () => {
  const s = state("default")();
  expect(s.isFinal).toBe(false);
  expect(s._regions).toBeUndefined();
});

test("regions() called twice overwrites", () => {
  const s = state("multi")();
  s.regions({ left: { initial: "a", states: { a: state("a")() } } });
  expect(s._regions).toBeDefined();
  expect(s._regions!.left).toBeDefined();
  const firstRegions = s._regions;
  s.regions({ right: { initial: "b", states: { b: state("b")() } } });
  expect(s._regions).not.toBe(firstRegions);
  expect(s._regions!.left).toBeUndefined();
  expect(s._regions!.right).toBeDefined();
});

describe("TransitionState", () => {
  test("stores state ref and payload", () => {
    const s = state("loaded")<{ data: string }>();
    const ts = new TransitionState(s, { data: "hello" });
    expect(ts.__stateRef).toBe(s);
    expect(ts.__payload).toEqual({ data: "hello" });
  });

  test("payload can be undefined", () => {
    const s = state("empty")();
    const ts = new TransitionState(s, undefined);
    expect(ts.__stateRef).toBe(s);
    expect(ts.__payload).toBeUndefined();
  });

  test("payload is mutable", () => {
    const s = state("loaded")<{ data: string }>();
    const ts = new TransitionState(s, { data: "hello" });
    ts.__payload.data = "world";
    expect(ts.__payload).toEqual({ data: "world" });
  });
});
