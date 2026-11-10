import { describe, expect, test } from "vite-plus/test";
import { graphWidth } from "./graph.ts";

describe("graphWidth", () => {
  test("floors labels at 0.6rem and caps them at 1.4em", () => {
    expect(graphWidth(1278)).toBe("width: clamp(63.90rem, 100%, 149.10em)");
  });

  test("the floor scales with the machine's width in rem, the cap in em", () => {
    for (const units of [120, 689, 1278]) {
      const match = /^width: clamp\(([\d.]+)rem, 100%, ([\d.]+)em\)$/.exec(graphWidth(units));
      expect(Number(match?.[1])).toBeCloseTo((units * 0.6) / 12, 2);
      expect(Number(match?.[2])).toBeCloseTo((units * 1.4) / 12, 2);
    }
  });
});
