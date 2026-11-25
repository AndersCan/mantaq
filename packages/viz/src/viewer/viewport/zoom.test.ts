import {
  anchoredScroll,
  clampZoom,
  fitZoom,
  viewBoxSize,
  zoomInFrom,
  zoomOutFrom,
} from "./zoom.ts";
import { expect, test } from "vite-plus/test";

test.each([
  [0.05, 0.1],
  [0.1, 0.1],
  [1.3, 1.3],
  [8, 8],
  [12, 8],
  [Number.POSITIVE_INFINITY, 8],
  [Number.NaN, 1],
])("clamps %d to %d", (scale, expected) => {
  expect(clampZoom(scale)).toBe(expected);
});

test.each([
  [1, 1.5, 0.75],
  [0.1, 0.25, 0.1],
  [8, 8, 6],
  [0.6, 0.75, 0.5],
  [0.9999999, 1.5, 0.75],
  [2.4, 3, 2],
  [0.01, 0.25, 0.1],
  [40, 8, 6],
])("from %d zoom in is %d and zoom out is %d", (scale, zoomedIn, zoomedOut) => {
  expect({ zoomedIn: zoomInFrom(scale), zoomedOut: zoomOutFrom(scale) }).toEqual({
    zoomedIn,
    zoomedOut,
  });
});

test.each([
  [{ width: 1000, height: 500 }, { width: 500, height: 500 }, 0.5],
  [{ width: 400, height: 800 }, { width: 1000, height: 400 }, 0.5],
  [{ width: 100, height: 50 }, { width: 300, height: 300 }, 3],
  [{ width: 10, height: 10 }, { width: 1000, height: 1000 }, 8],
  [{ width: 100_000, height: 10 }, { width: 100, height: 100 }, 0.1],
  [{ width: 0, height: 10 }, { width: 100, height: 100 }, 1],
  [{ width: 100, height: 100 }, { width: 0, height: 0 }, 1],
])("fits %j in %j at %d", (drawing, box, expected) => {
  expect(fitZoom(drawing, { box })).toBe(expected);
});

test("zooming in at the pointer scrolls so the point under it stays", () => {
  const next = anchoredScroll({
    scroll: { x: 100, y: 40 },
    pointer: { x: 50, y: 60 },
    origin: { x: 0, y: 0 },
    originAfter: { x: 0, y: 0 },
    from: 1,
    to: 2,
  });
  expect(next).toEqual({ x: 250, y: 140 });
});

test("a drawing that moves with the scale, as a centered one does, keeps the point too", () => {
  const next = anchoredScroll({
    scroll: { x: 0, y: 0 },
    pointer: { x: 300, y: 100 },
    origin: { x: 200, y: 20 },
    originAfter: { x: 100, y: 20 },
    from: 1,
    to: 1.5,
  });
  expect(next).toEqual({ x: -50, y: 40 });
});

test.each([
  ["0 0 640 480", { width: 640, height: 480 }],
  [" -10,-10, 20.5 30 ", { width: 20.5, height: 30 }],
  ["0 0 0 480", undefined],
  ["0 0 640", undefined],
  ["0 0 wide 480", undefined],
  ["", undefined],
  [undefined, undefined],
])("the viewBox %j is %j", (viewBox, expected) => {
  expect(viewBoxSize(viewBox)).toEqual(expected);
});
