import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createAbortController } from "./abort.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAbortController", () => {
  test("uses the global controller when present", () => {
    expect(createAbortController().signal).toBeInstanceOf(AbortSignal);
  });

  describe("without a global AbortController", () => {
    function make() {
      vi.stubGlobal("AbortController", undefined);
      return createAbortController();
    }

    test("starts not aborted and aborts with a reason", () => {
      const controller = make();
      expect(controller.signal.aborted).toBe(false);
      controller.signal.throwIfAborted();
      controller.abort("why");
      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe("why");
      expect(() => controller.signal.throwIfAborted()).toThrow("why");
    });

    test("default reason is an Error", () => {
      const controller = make();
      controller.abort();
      expect(controller.signal.reason).toBeInstanceOf(Error);
    });

    test("listeners fire once; second abort is a no-op", () => {
      const controller = make();
      const fn = vi.fn();
      controller.signal.addEventListener("abort", fn);
      controller.abort("a");
      controller.abort("b");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(controller.signal.reason).toBe("a");
    });

    test("removed listener is not called", () => {
      const controller = make();
      const fn = vi.fn();
      controller.signal.addEventListener("abort", fn);
      controller.signal.removeEventListener("abort", fn);
      controller.abort();
      expect(fn).not.toHaveBeenCalled();
    });

    test("once listener is honoured and onabort runs", () => {
      const controller = make();
      const fn = vi.fn();
      const onabort = vi.fn();
      controller.signal.addEventListener("abort", fn, { once: true });
      controller.signal.onabort = onabort;
      controller.abort();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(onabort).toHaveBeenCalledTimes(1);
    });
  });
});
