import { test, describe } from "vite-plus/test";
import { fc, anyName, runProperty } from "@mantaq/pbt";
import { broadcast } from "../src/transitions/broadcast.ts";

describe("broadcast property tests", () => {
  test("fans out exactly once per key in key order", () => {
    runProperty(
      fc.tuple(fc.array(anyName, { minLength: 0, maxLength: 8 }), anyName),
      ([keys, eventId]) => {
        const sent: Array<{ key: string; event: { type: string } }> = [];
        const map = {
          keys: () => keys,
          send: (key: string, event: { type: string }) => sent.push({ key, event }),
        };
        broadcast(map, { type: eventId });
        const expected = keys.map((key) => ({ key, event: { type: eventId } }));
        return JSON.stringify(sent) === JSON.stringify(expected);
      },
    );
  });
});
