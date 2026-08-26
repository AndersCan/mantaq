import { withPromise } from "./promise.ts";
import { fc, anyPayload } from "@mantaq/pbt";
import { describe, test } from "vite-plus/test";

function successEvent(data: unknown) {
  return { type: "success", data };
}

function errorEvent(err: unknown) {
  return { type: "error", err: String(err) };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("withPromise property tests", () => {
  test("emits success exactly once with the data for a resolved promise", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const emitted: Array<{ type: string }> = [];
        void withPromise({
          promise: Promise.resolve(data),
          signal: new AbortController().signal,
          emit: (event) => emitted.push(event),
          events: { success: successEvent, error: errorEvent },
        });
        await flush();
        if (emitted.length !== 1) return false;
        if (emitted[0].type !== "success") return false;
        return true;
      }),
    );
  });

  test("emits error exactly once for a rejected promise", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const emitted: Array<{ type: string }> = [];
        void withPromise({
          promise: Promise.reject(data),
          signal: new AbortController().signal,
          emit: (event) => emitted.push(event),
          events: { success: successEvent, error: errorEvent },
        });
        await flush();
        if (emitted.length !== 1) return false;
        if (emitted[0].type !== "error") return false;
        return true;
      }),
    );
  });

  test("skips both success and error emission when the signal already aborted", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const controller = new AbortController();
        controller.abort();
        const emitted: Array<{ type: string }> = [];
        void withPromise({
          promise: Promise.resolve(data),
          signal: controller.signal,
          emit: (event) => emitted.push(event),
          events: { success: successEvent, error: errorEvent },
        });
        await flush();
        return emitted.length === 0;
      }),
    );
  });

  test("emits exactly once and ignores later aborts for a resolved promise", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const controller = new AbortController();
        const emitted: Array<{ type: string }> = [];
        void withPromise({
          promise: Promise.resolve(data),
          signal: controller.signal,
          emit: (event) => emitted.push(event),
          events: { success: successEvent, error: errorEvent },
        });
        await flush();
        controller.abort();
        await flush();
        return emitted.length === 1 && emitted[0].type === "success";
      }),
    );
  });
});
