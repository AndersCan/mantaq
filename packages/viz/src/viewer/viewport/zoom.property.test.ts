import {
  anchoredScroll,
  clampZoom,
  fitZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  zoomInFrom,
  zoomOutFrom,
} from "./zoom.ts";
import { expect, test } from "vite-plus/test";
import fc from "fast-check";

const run = { seed: 0x200, numRuns: 1000 };

const anyScale = fc.double({ min: 0, max: 20, noNaN: true });
const anyLength = fc.double({ min: 1, max: 20_000, noNaN: true });
const anyOffset = fc.double({ min: -5000, max: 5000, noNaN: true });
const anyPoint = fc.record({ x: anyOffset, y: anyOffset });
const anySize = fc.record({ width: anyLength, height: anyLength });

test("a clamped scale is in the zoom range and clamps to itself", () => {
  fc.assert(
    fc.property(anyScale, (scale) => {
      const clamped = clampZoom(scale);
      expect({
        inRange: clamped >= MIN_ZOOM && clamped <= MAX_ZOOM,
        again: clampZoom(clamped),
      }).toEqual({
        inRange: true,
        again: clamped,
      });
    }),
    run,
  );
});

test("zoom in lands on a step above the scale, zoom out on a step below, until the range ends", () => {
  fc.assert(
    fc.property(anyScale, (scale) => {
      const current = clampZoom(scale);
      const zoomedIn = zoomInFrom(scale);
      const zoomedOut = zoomOutFrom(scale);
      expect({
        steps: ZOOM_STEPS.includes(zoomedIn) && ZOOM_STEPS.includes(zoomedOut),
        zoomedIn: zoomedIn > current || zoomedIn === MAX_ZOOM,
        zoomedOut: zoomedOut < current || zoomedOut === MIN_ZOOM,
      }).toEqual({ steps: true, zoomedIn: true, zoomedOut: true });
    }),
    run,
  );
});

test("zoom out undoes zoom in on every step but the largest", () => {
  for (const step of ZOOM_STEPS.slice(0, -1)) {
    expect(zoomOutFrom(zoomInFrom(step))).toBe(step);
  }
});

test("the fitted drawing fits the box, and fills it on one side unless the range stops it", () => {
  fc.assert(
    fc.property(anySize, anySize, (drawing, box) => {
      const scale = fitZoom(drawing, { box });
      const width = drawing.width * scale;
      const height = drawing.height * scale;
      const clamped = scale === MIN_ZOOM || scale === MAX_ZOOM;
      const fills = Math.abs(width - box.width) < 1e-6 || Math.abs(height - box.height) < 1e-6;
      expect({
        fits: scale === MIN_ZOOM || (width <= box.width + 1e-6 && height <= box.height + 1e-6),
        fills: clamped || fills,
      }).toEqual({ fits: true, fills: true });
    }),
    run,
  );
});

const anyRatio = fc.double({ min: MIN_ZOOM / MAX_ZOOM, max: MAX_ZOOM / MIN_ZOOM, noNaN: true });
const anyAnchor = fc.record({
  scroll: anyPoint,
  pointer: anyPoint,
  origin: anyPoint,
  originAfter: anyPoint,
  ratio: anyRatio,
});

test("after the scroll, the drawing's point under the pointer is the one that was under it before", () => {
  fc.assert(
    fc.property(anyAnchor, (anchor) => {
      const next = anchoredScroll(anchor);
      const shown = {
        x: anchor.originAfter.x - (next.x - anchor.scroll.x),
        y: anchor.originAfter.y - (next.y - anchor.scroll.y),
      };
      const before = {
        x: anchor.pointer.x - anchor.origin.x,
        y: anchor.pointer.y - anchor.origin.y,
      };
      const after = {
        x: (anchor.pointer.x - shown.x) / anchor.ratio,
        y: (anchor.pointer.y - shown.y) / anchor.ratio,
      };
      const close = Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6;
      expect(close).toBe(true);
    }),
    run,
  );
});

test("a drawing that neither grew nor moved keeps the scroll", () => {
  fc.assert(
    fc.property(anyAnchor, (anchor) => {
      const next = anchoredScroll({ ...anchor, originAfter: anchor.origin, ratio: 1 });
      const close =
        Math.abs(next.x - anchor.scroll.x) < 1e-6 && Math.abs(next.y - anchor.scroll.y) < 1e-6;
      expect(close).toBe(true);
    }),
    run,
  );
});
