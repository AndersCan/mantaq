import { expect, test } from "vite-plus/test";
import { insideBand, scrollToShow } from "./keep-in-view.ts";

const box = (left: number, max = 5700) => ({ left, width: 300, max });

test.each([
  [{ left: 40, right: 160 }, 0, 0],
  [{ left: 2400, right: 2520 }, 0, 2236],
  [{ left: 2400, right: 2520 }, 2300, 2300],
  [{ left: 1000, right: 1120 }, 2236, 984],
  [{ left: 990, right: 1100 }, 1000, 974],
  [{ left: 100, right: 700 }, 0, 84],
  [{ left: 5900, right: 5990 }, 0, 5700],
  [{ left: 4, right: 60 }, 500, 0],
  [{ left: 2400.6, right: 2520.6 }, 0, 2237],
])("shows %j from %d at %d", (span, left, expected) => {
  expect(scrollToShow(box(left), [span])).toBe(expected);
});

test("a box with no width moves nothing", () => {
  expect(scrollToShow({ left: 7, width: 0, max: 100 }, [{ left: 900, right: 990 }])).toBe(7);
});

test.each([
  [
    [
      { left: 2400, right: 2520 },
      { left: 2560, right: 2650 },
    ],
    2366,
  ],
  [
    [
      { left: 2400, right: 2520 },
      { left: 5000, right: 5100 },
    ],
    2236,
  ],
])("joins the spans that fit: %j at %d", (spans, expected) => {
  expect(scrollToShow(box(0), spans)).toBe(expected);
});

test.each([
  [0, 2366],
  [3000, 2384],
])("joins a later span on the left: from %d at %d", (left, expected) => {
  const spans = [
    { left: 2560, right: 2650 },
    { left: 2400, right: 2520 },
  ];
  expect(scrollToShow(box(left), spans)).toBe(expected);
});

test("no spans moves nothing", () => {
  expect(scrollToShow(box(40), [])).toBe(40);
});

test.each([
  [{ top: 100, bottom: 200 }, true],
  [{ top: 120, bottom: 180 }, true],
  [{ top: 99, bottom: 150 }, false],
  [{ top: 150, bottom: 201 }, false],
  [{ top: 50, bottom: 300 }, false],
])("insideBand %j is %s in 100..200", (rect, expected) => {
  expect(insideBand(rect, { top: 100, bottom: 200 })).toBe(expected);
});
