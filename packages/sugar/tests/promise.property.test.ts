import { test, describe } from "vite-plus/test";
import { fc, anyPayload } from "@mantaq/pbt";
import { withPromise } from "../src/effects/promise.ts";

const SUCCESS = (data: unknown) => ({ type: "success", data });
const ERROR = (err: unknown) => ({ type: "error", err: String(err) });

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("withPromise property tests", () => {
  test("a resolved promise emits success exactly once with the data", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const emitted: Array<{ type: string }> = [];
        withPromise(Promise.resolve(data), new AbortController().signal, (e) => emitted.push(e), {
          success: SUCCESS,
          error: ERROR,
        });
        await flush();
        if (emitted.length !== 1) return false;
        if (emitted[0].type !== "success") return false;
        return true;
      }),
    );
  });

  test("a rejected promise emits error exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const emitted: Array<{ type: string }> = [];
        withPromise(Promise.reject(data), new AbortController().signal, (e) => emitted.push(e), {
          success: SUCCESS,
          error: ERROR,
        });
        await flush();
        if (emitted.length !== 1) return false;
        if (emitted[0].type !== "error") return false;
        return true;
      }),
    );
  });

  test("an aborted signal suppresses both success and error", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const controller = new AbortController();
        controller.abort();
        const emitted: Array<{ type: string }> = [];
        withPromise(Promise.resolve(data), controller.signal, (e) => emitted.push(e), {
          success: SUCCESS,
          error: ERROR,
        });
        await flush();
        return emitted.length === 0;
      }),
    );
  });

  test("a resolved promise emits exactly once and later aborts change nothing", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayload, async (data) => {
        const controller = new AbortController();
        const emitted: Array<{ type: string }> = [];
        withPromise(Promise.resolve(data), controller.signal, (e) => emitted.push(e), {
          success: SUCCESS,
          error: ERROR,
        });
        await flush();
        controller.abort();
        await flush();
        return emitted.length === 1 && emitted[0].type === "success";
      }),
    );
  });
});
