import { expect, test } from "vite-plus/test";
import { Any } from "../src/index.ts";

test("Any constant", () => {
  expect(Any).toBe("Any");
});
