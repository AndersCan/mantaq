import { describe, expect, test } from "vite-plus/test";
import { decodeLiveSteps, encodeLiveStep } from "./moves.ts";
import type { VizStep } from "./schema.ts";

describe("live step text", () => {
  const regionStep: VizStep = {
    kind: "event",
    event: "photoPicked",
    payload: { fileName: "a.jpg" },
    actor: { region: "upload" },
  };

  test("a region step round-trips", () => {
    const text = encodeLiveStep(regionStep);
    expect(text).toBe('upload>photoPicked={"fileName":"a.jpg"}');
    expect(decodeLiveSteps([text])).toEqual([regionStep]);
  });

  test("a region step without a payload round-trips", () => {
    const step: VizStep = {
      kind: "event",
      event: "connectionLost",
      payload: null,
      actor: { region: "a.b" },
    };
    expect(encodeLiveStep(step)).toBe("a.b>connectionLost");
    expect(decodeLiveSteps(["a.b>connectionLost"])).toEqual([step]);
  });

  test("a map child step round-trips with its key encoded", () => {
    const step: VizStep = {
      kind: "event",
      event: "retryPressed",
      payload: null,
      actor: { map: "photos", key: "p 1]" },
    };
    expect(encodeLiveStep(step)).toBe("photos[p%201%5D]>retryPressed");
    expect(decodeLiveSteps(["photos[p%201%5D]>retryPressed"])).toEqual([step]);
  });

  test("a map step with a payload and an empty key", () => {
    const step: VizStep = {
      kind: "event",
      event: "go",
      payload: { a: 1 },
      actor: { map: "m", key: "" },
    };
    expect(encodeLiveStep(step)).toBe('m[]>go={"a":1}');
    expect(decodeLiveSteps(['m[]>go={"a":1}'])).toEqual([step]);
  });

  test("a bad key encoding ends the list", () => {
    expect(decodeLiveSteps(["photos[%E0%A4%A]>go", "go"])).toEqual([]);
  });

  test("root steps and advances are unchanged", () => {
    expect(decodeLiveSteps(["go", "@800"])).toEqual([
      { kind: "event", event: "go", payload: null },
      { kind: "advance", ms: 800 },
    ]);
  });

  test("a payload containing > is not read as a region", () => {
    expect(decodeLiveSteps(['go={"a":">"}'])).toEqual([
      { kind: "event", event: "go", payload: { a: ">" } },
    ]);
  });

  test("a prefix without an event, or an empty region, ends the list", () => {
    expect(decodeLiveSteps(["upload>", "go"])).toEqual([]);
    expect(decodeLiveSteps([">go", "go"])).toEqual([]);
  });
});
