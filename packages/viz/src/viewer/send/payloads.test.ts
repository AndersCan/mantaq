import { decodePayloads, encodePayloads, legacyPayloads, withEdit } from "./payloads.ts";
import { describe, expect, test } from "vite-plus/test";
import type { VizEvent } from "../../schema.ts";

describe("payload changes", () => {
  test("an edit sets one field of one event, and undefined drops it and then the event", () => {
    const first = withEdit({}, { event: "pay", field: "coupon", value: "free" });
    const second = withEdit(first, { event: "pay", field: "total", value: 3 });
    const dropped = withEdit(
      withEdit(second, { event: "pay", field: "coupon", value: undefined }),
      {
        event: "pay",
        field: "total",
        value: undefined,
      },
    );
    expect({ first, second, dropped }).toEqual({
      first: { pay: { coupon: "free" } },
      second: { pay: { coupon: "free", total: 3 } },
      dropped: {},
    });
  });

  test("round-trip through the address; entries with no event, no = or a non-object are skipped", () => {
    const payloads = { pay: { coupon: "a=b" }, add: { lines: [1] } };
    const decoded = decodePayloads([...encodePayloads(payloads), "bad", "=1", "x=3", "y={"]);
    expect(decoded).toEqual(payloads);
  });

  test("an old field value applies to every event that has a field of that name", () => {
    const field = {
      name: "code",
      type: "string",
      optional: false,
      doc: "",
      input: "text" as const,
      choices: [],
      sample: "c",
    };
    const events: VizEvent[] = [
      { id: "ask", internal: false, doc: "", payload: [field] },
      { id: "answered", internal: false, doc: "", payload: [field, { ...field, name: "answer" }] },
      { id: "ping", internal: false, doc: "", payload: [] },
    ];
    expect(legacyPayloads({ code: "c1", other: 1 }, events)).toEqual({
      ask: { code: "c1" },
      answered: { code: "c1" },
    });
  });
});
