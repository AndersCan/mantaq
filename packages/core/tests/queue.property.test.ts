import { test, describe } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { InternalQueue } from "../src/queue.ts";

type Op = { t: "push"; count: number } | { t: "process" } | { t: "cancellable"; stop: number };

function referenceRun(ops: Op[]): { seen: string[]; lengths: number[]; stops: number[] } {
  const model: string[] = [];
  let index = 0;
  let processing = false;
  let stopped = false;
  const seen: string[] = [];
  const lengths: number[] = [];
  const stops: number[] = [];
  let n = 0;

  for (const op of ops) {
    if (op.t === "push") {
      if (!stopped) {
        for (let i = 0; i < op.count; i++) model.push(`e${n++}`);
      }
    } else if (op.t === "process") {
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
          if (processed > op.stop) {
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
  test("push/process sequences drain FIFO with exact length and stop semantics", () => {
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
        const queue = new InternalQueue();
        const seenReal: string[] = [];
        const lengthsReal: number[] = [];
        const stopsReal: number[] = [];
        let n = 0;

        for (const op of ops) {
          if (op.t === "push") {
            const events = Array.from({ length: op.count }, () => ({ id: `e${n++}` }));
            queue.push(...events);
          } else if (op.t === "process") {
            queue.process((e) => {
              seenReal.push(e.id);
            });
          } else {
            let processed = 0;
            queue.processCancellable((e) => {
              seenReal.push(e.id);
              processed++;
              return processed <= op.stop;
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
