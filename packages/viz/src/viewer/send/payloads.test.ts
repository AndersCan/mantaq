import { decodePayloads, encodePayloads, legacyPayloads, withEdit } from "./payloads.ts";
import { describe, expect, test } from "vite-plus/test";
import type { VizEvent } from "../../schema.ts";

const shop = { machines: ["checkout", "payment"], shown: "checkout" };

describe("payload changes", () => {
  test("an edit sets one field of one event of one machine, and undefined drops it, then the event, then the machine", () => {
    const pay = { machine: "checkout", event: "pay" };
    const first = withEdit({}, { ...pay, field: "coupon", value: "free" });
    const second = withEdit(first, { ...pay, field: "total", value: 3 });
    const other = withEdit(second, { machine: "payment", event: "pay", field: "card", value: 1 });
    const couponGone = withEdit(other, { ...pay, field: "coupon", value: undefined });
    const dropped = withEdit(couponGone, { ...pay, field: "total", value: undefined });
    expect({ first, other, dropped }).toEqual({
      first: { checkout: { pay: { coupon: "free" } } },
      other: { checkout: { pay: { coupon: "free", total: 3 } }, payment: { pay: { card: 1 } } },
      dropped: { payment: { pay: { card: 1 } } },
    });
  });

  test("round-trip through the address as machine:event; entries with no event, no = or a non-object are skipped", () => {
    const payloads = {
      checkout: { pay: { coupon: "a=b" }, add: { lines: [1] } },
      payment: { pay: { card: "c:d" } },
    };
    const encoded = encodePayloads(payloads);
    const decoded = decodePayloads([...encoded, "bad", "=1", "x=3", "y={", "payment:={}"], shop);
    expect({ encoded, decoded }).toEqual({
      encoded: [
        'checkout:pay={"coupon":"a=b"}',
        'checkout:add={"lines":[1]}',
        'payment:pay={"card":"c:d"}',
      ],
      decoded: payloads,
    });
  });

  test("an old bare entry belongs to the machine the link opens, also when its event has a colon", () => {
    const decoded = decodePayloads(['pay={"coupon":"a"}', 'step:two={"n":1}'], shop);
    expect(decoded).toEqual({ checkout: { pay: { coupon: "a" }, "step:two": { n: 1 } } });
  });

  test("an old field value applies to every event of every machine that has a field of that name", () => {
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
    const machines = [
      { id: "checkout", events },
      { id: "payment", events: events.slice(0, 1) },
    ];
    expect(legacyPayloads({ code: "c1", other: 1 }, machines)).toEqual({
      checkout: { ask: { code: "c1" }, answered: { code: "c1" } },
      payment: { ask: { code: "c1" } },
    });
  });
});
