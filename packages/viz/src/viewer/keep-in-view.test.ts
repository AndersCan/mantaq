import { expect, test } from "vite-plus/test";
import { scrollToShow, scrollToShowAround } from "./keep-in-view.ts";

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
  expect(scrollToShow(box(left), span)).toBe(expected);
});

test("a box with no width moves nothing", () => {
  expect(scrollToShow({ left: 7, width: 0, max: 100 }, { left: 900, right: 990 })).toBe(7);
});

// The vertical axis: a 400px band that starts at content offset `top`.
const band = (top: number, max = 1600) => ({ left: top, width: 400, max });

test.each([
  [{ left: 100, right: 140 }, 0, 0],
  [{ left: 900, right: 940 }, 0, 556],
  [{ left: 100, right: 140 }, 800, 84],
  [{ left: 900, right: 940 }, 800, 800],
  [{ left: 1990, right: 2030 }, 0, 1600],
])("shows rows %j from top %d at %d", (span, top, expected) => {
  expect(scrollToShow(band(top), span)).toBe(expected);
});

test.each([
  [
    "the node and its labels fit: they all show",
    { left: 500, right: 560 },
    [{ left: 700, right: 760 }],
    476,
  ],
  [
    "the labels are too wide: the most whole labels with the node",
    { left: 500, right: 560 },
    [
      { left: 200, right: 260 },
      { left: 600, right: 660 },
      { left: 700, right: 760 },
    ],
    484,
  ],
  [
    "a tie: the view that moves the least",
    { left: 500, right: 560 },
    [
      { left: 290, right: 300 },
      { left: 760, right: 775 },
    ],
    276,
  ],
  [
    "the node alone is too wide: its start shows",
    { left: 100, right: 500 },
    [{ left: 0, right: 60 }],
    84,
  ],
])("%s", (_, node, labels, expected) => {
  expect(scrollToShowAround(box(0), { node, labels })).toBe(expected);
});
