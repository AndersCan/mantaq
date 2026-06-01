import { expect, test, describe } from "vite-plus/test";
import { broadcast, type SendableMap } from "../src/transitions/broadcast.ts";

function mockMap(keys: string[], sent: Array<{ key: string; event: unknown }>): SendableMap {
  return {
    keys: () => keys,
    send: (key: string, event: unknown) => sent.push({ key, event }),
  };
}

describe("broadcast", () => {
  test("sends event to all children", () => {
    const sent: Array<{ key: string; event: unknown }> = [];
    const map = mockMap(["a", "b"], sent);

    broadcast(map, { id: "ping" });

    expect(sent).toEqual([
      { key: "a", event: { id: "ping" } },
      { key: "b", event: { id: "ping" } },
    ]);
  });

  test("empty map — no error", () => {
    const sent: Array<{ key: string; event: unknown }> = [];
    const map = mockMap([], sent);

    expect(() => broadcast(map, { id: "ping" })).not.toThrow();
    expect(sent).toEqual([]);
  });
});
