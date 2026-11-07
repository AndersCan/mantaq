import { describe, expect, test } from "vite-plus/test";
import { docsMachines, isDocsMachineId } from "./docs-machines.ts";

describe("isDocsMachineId", () => {
  test("accepts every registered machine id", () => {
    for (const id of Object.keys(docsMachines)) expect(isDocsMachineId(id)).toBe(true);
  });

  test("rejects unknown ids and inherited object keys", () => {
    for (const id of ["nope", "", "toString", "__proto__", "constructor"]) {
      expect(isDocsMachineId(id)).toBe(false);
    }
  });
});
