import { InternalQueue } from "./queue.ts";
import { fc, runProperty } from "@mantaq/pbt";
import { test, describe } from "vite-plus/test";

type Op = { t: "push"; count: number } | { t: "process" } | { t: "cancellable"; stop: number };

function referenceRun(ops: Op[]): { seen: string[]; lengths: number[]; stops: number[] } {
  const model: string[] = [];
  let index = 0;
  let processing = false;
  let stopped = false;
  const seen: string[] = [];
  const lengths: number[] = [];
  const stops: number[] = [];
  let counter = 0;

  for (const entry of ops) {
    if (entry.t === "push") {
      if (!stopped) {
        for (let idx = 0; idx < entry.count; idx++) model.push(`e${counter++}`);
      }
    } else if (entry.t === "process") {
      if (!processing) {
        processing = true;
        while (index < model.length) {
          if (stopped) break;
          seen.push(model[index++]);
        }
        model.length = 0;
        index = 0;
        processing = false;
        stopped = false;
      }
    } else {
      if (!processing) {
        processing = true;
        let processed = 0;
        while (index < model.length) {
          if (stopped) break;
          seen.push(model[index++]);
          processed++;
          if (processed > entry.stop) {
            stopped = true;
            break;
          }
        }
        stops.push(processed);
        model.length = 0;
        index = 0;
        processing = false;
        stopped = false;
      }
    }
    lengths.push(model.length - index);
  }
  return { seen, lengths, stops };
}

describe("InternalQueue property tests", () => {
  test("push/process sequences keep FIFO order with exact length and stop semantics", () => {
    runProperty(
      fc.array(
        fc.oneof(
          fc.record({ t: fc.constant("push"), count: fc.integer({ min: 1, max: 3 }) }),
          fc.record({ t: fc.constant("process") }),
          fc.record({ t: fc.constant("cancellable"), stop: fc.integer({ min: 0, max: 5 }) }),
        ),
        { minLength: 1, maxLength: 20 },
      ),
      (ops) => {
        const queue = InternalQueue();
        const seenReal: string[] = [];
        const lengthsReal: number[] = [];
        const stopsReal: number[] = [];
        let counter = 0;

        for (const entry of ops) {
          if (entry.t === "push") {
            const events = Array.from({ length: entry.count }, () => ({ type: `e${counter++}` }));
            queue.push(...events);
          } else if (entry.t === "process") {
            queue.processCancellable((e) => {
              seenReal.push(e.type);
              return true;
            });
          } else {
            let processed = 0;
            queue.processCancellable((e) => {
              seenReal.push(e.type);
              processed++;
              return processed <= entry.stop;
            });
            stopsReal.push(processed);
          }
          lengthsReal.push(queue.length);
        }

        const reference = referenceRun(ops);
        if (seenReal.join(",") !== reference.seen.join(",")) return false;
        if (stopsReal.join(",") !== reference.stops.join(",")) return false;
        if (lengthsReal.join(",") !== reference.lengths.join(",")) return false;
        return true;
      },
    );
  });
});
