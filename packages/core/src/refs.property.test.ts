import type { Snapshot } from "./actor-internal.ts";
import { parseTarget } from "./dispatch.ts";
import { event } from "./event.ts";
import { buildSnapshot } from "./snapshot.ts";
import { state } from "./state.ts";
import { Subscribers } from "./subscribers.ts";
import { fc, anyName, anyPayload, anySnapshot, runProperty } from "@mantaq/pbt";
import { test, describe, expect } from "vite-plus/test";

describe("event ref property tests", () => {
  test("create builds payload with id and is() accepts only matching ids", () => {
    const anyPayloadObject = fc.object({
      maxKeys: 4,
      values: [fc.string(), fc.integer(), fc.boolean()],
    });
    runProperty(fc.tuple(anyName, anyPayloadObject, anyName), ([id, payload, otherId]) => {
      const ref = event(id)<Record<string, unknown>>();
      if (id === otherId) return true;
      const created = ref.create({ ...payload });
      if (created.type !== id) return false;
      const createdPayload = created.payload;
      if (typeof createdPayload !== "object" || createdPayload === null) return false;
      for (const [key, value] of Object.entries(payload)) {
        if (createdPayload[key] !== value) return false;
      }
      if (!ref.is(created)) return false;
      if (ref.is({ type: otherId })) return false;
      // JSON boundary keeps the real null wire value without a null literal.
      if (ref.is(JSON.parse("null"))) return false;
      if (ref.is(42)) return false;
      return true;
    });
  });

  /**
   * Soundness of the per-type symbol brand (#262): the brand must be the only
   * thing `is()` trusts, so only envelopes minted by `create()` pass — and only
   * for their own type. These directed assertions back the mutation gate.
   */
  test("same-type ref accepts its own create() and rejects another type's", () => {
    const a = event("A")<void>();
    const b = event("B")<void>();
    expect(a.is(a.create())).toBe(true);
    expect(b.is(b.create())).toBe(true);
    // A must not accept B's envelope (brand is per-type, not just `type` string)
    expect(a.is(b.create())).toBe(false);
    expect(b.is(a.create())).toBe(false);
  });

  test("two refs of the same type keep one cached brand", () => {
    const firstRef = event("A")<void>();
    const secondRef = event("A")<void>();
    expect(firstRef.is(secondRef.create())).toBe(true);
    expect(secondRef.is(firstRef.create())).toBe(true);
  });

  test("is() rejects non-objects and untyped hand-built objects", () => {
    const a = event("A")<void>();
    expect(a.is(JSON.parse("null"))).toBe(false);
    expect(a.is(42)).toBe(false);
    expect(a.is("A")).toBe(false);
    expect(a.is({})).toBe(false);
    // hand-built envelope has no brand, so it must be rejected
    expect(a.is({ type: "A" })).toBe(false);
  });

  test("create() keeps payload semantics for with/without payload", () => {
    const a = event("A")<{ n: number }>();
    expect(a.create()).toEqual({ type: "A" });
    expect(a.create({ n: 1 })).toEqual({ type: "A", payload: { n: 1 } });
    expect(a.is(a.create({ n: 1 }))).toBe(true);
  });

  test("enumeration skips the brand (it stays out of the observable shape)", () => {
    const a = event("A")<void>();
    const env = a.create();
    expect(Object.keys(env)).toEqual(["type"]);
    expect(JSON.parse(JSON.stringify(env))).toEqual({ type: "A" });
  });
});

describe("state ref property tests", () => {
  test("create returns { state, payload } and final copies name and regions", () => {
    runProperty(
      fc.tuple(anyName, anyPayload, fc.array(anyName, { minLength: 1, maxLength: 3 })),
      ([name, payload, regionNames]) => {
        const regions = Object.fromEntries(
          regionNames.map((regionName) => [
            regionName,
            { initial: "x", states: { x: state("x")() } },
          ]),
        );
        const ref = state(name)<unknown>().regions(regions);
        const created = ref.create(payload);
        if (created.state !== ref) return false;
        if (created.payload !== payload) return false;

        const final = ref.final();
        if (!final.isFinal) return false;
        if (final.name !== name) return false;
        if (final._regions !== regions) return false;
        return true;
      },
    );
  });
});

describe("parseTarget property tests", () => {
  test("resolves bare refs, wrapped refs, and absence", () => {
    runProperty(fc.tuple(anyName, anyPayload), ([name, payload]) => {
      const ref = state(name)<unknown>();
      const bare = parseTarget({ state: ref, payload });
      if (!bare || bare.state !== ref) return false;
      if (bare.payload !== payload) return false;

      const wrapped = parseTarget({ state: { state: ref, payload }, payload });
      if (!wrapped || wrapped.state !== ref) return false;
      if (wrapped.payload !== payload) return false;

      if (parseTarget({}) !== undefined) return false;
      return true;
    });
  });
});

describe("buildSnapshot property tests", () => {
  test("builds path and preserves region snapshots", () => {
    runProperty(
      fc.tuple(anyName, fc.boolean(), fc.array(anySnapshot, { minLength: 1, maxLength: 4 })),
      ([name, isFinal, childSnaps]) => {
        const regions: Record<string, Snapshot> = {};
        const children: Record<string, { snapshot(): Snapshot }> = {};
        for (let idx = 0; idx < childSnaps.length; idx++) {
          const regionName = `region${idx}`;
          regions[regionName] = childSnaps[idx];
          children[regionName] = { snapshot: () => childSnaps[idx] };
        }
        const ref = isFinal ? state(name)().final() : state(name)();
        const snap = buildSnapshot({ stateRef: ref, regions: children, context: {} });
        if (snap.path[0] !== name) return false;
        for (const [key, value] of Object.entries(regions)) {
          if (snap.regions[key] !== value) return false;
        }
        if (snap.done !== (isFinal ? true : undefined)) return false;
        return true;
      },
    );
  });
});

describe("Subscribers property tests", () => {
  test("emit reaches exactly the still-subscribed callbacks", () => {
    runProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (keep) => {
      const subs = Subscribers<unknown>();
      const called: number[] = [];
      const offs: Array<() => void> = [];
      for (let idx = 0; idx < keep.length; idx++) {
        offs.push(subs.addChange(() => called.push(idx)));
      }
      for (let idx = 0; idx < keep.length; idx++) {
        if (!keep[idx]) offs[idx]();
      }
      const snap: Snapshot = { path: ["idle"], context: {}, regions: {} };
      subs.emitChange(snap);
      const expectedEntries: number[] = [];
      for (let entryIdx = 0; entryIdx < keep.length; entryIdx++) {
        if (keep[entryIdx]) expectedEntries.push(entryIdx);
      }
      const expected = expectedEntries.join(",");
      if (called.join(",") !== expected) return false;
      return true;
    });
  });
});
