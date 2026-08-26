import { broadcast } from "./broadcast.ts";
import { fc, anyName, runProperty } from "@mantaq/pbt";
import { describe, test } from "vite-plus/test";

describe("broadcast property tests", () => {
  test("calls send exactly once per key in key order", () => {
    runProperty(
      fc.tuple(fc.array(anyName, { minLength: 0, maxLength: 8 }), anyName),
      ([keys, eventId]) => {
        const sent: Array<{ key: string; event: { type: string } }> = [];
        const map = {
          keys() {
            return keys;
          },
          send(key: string, ...events: [event: { type: string }]) {
            for (const event of events) {
              sent.push({ key, event });
            }
          },
        };
        broadcast(map, { type: eventId });
        const expected = keys.map((key) => ({ key, event: { type: eventId } }));
        return JSON.stringify(sent) === JSON.stringify(expected);
      },
    );
  });
});
