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
const anyZoom = fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true });
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

test("the drawing's point under the pointer is the same before and after the scale changes", () => {
  fc.assert(
    fc.property(
      fc.record({ scroll: anyPoint, pointer: anyPoint, origin: anyPoint, originAfter: anyPoint }),
      anyZoom,
      anyZoom,
      (anchor, from, to) => {
        const next = anchoredScroll({ ...anchor, from, to });
        const before = (anchor.scroll.x + anchor.pointer.x - anchor.origin.x) / from;
        const after = (next.x + anchor.pointer.x - anchor.originAfter.x) / to;
        const beforeY = (anchor.scroll.y + anchor.pointer.y - anchor.origin.y) / from;
        const afterY = (next.y + anchor.pointer.y - anchor.originAfter.y) / to;
        expect({
          x: Math.abs(after - before) < 1e-6,
          y: Math.abs(afterY - beforeY) < 1e-6,
        }).toEqual({
          x: true,
          y: true,
        });
      },
    ),
    run,
  );
});

test("zooming back at the same pointer returns to the same scroll", () => {
  fc.assert(
    fc.property(
      fc.record({ scroll: anyPoint, pointer: anyPoint, origin: anyPoint }),
      anyZoom,
      anyZoom,
      (anchor, from, to) => {
        const there = anchoredScroll({ ...anchor, originAfter: anchor.origin, from, to });
        const back = anchoredScroll({
          ...anchor,
          scroll: there,
          originAfter: anchor.origin,
          from: to,
          to: from,
        });
        const close =
          Math.abs(back.x - anchor.scroll.x) < 1e-6 && Math.abs(back.y - anchor.scroll.y) < 1e-6;
        expect(close).toBe(true);
      },
    ),
    run,
  );
});
