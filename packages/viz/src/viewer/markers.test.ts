// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import fc from "fast-check";
import type { VizLiveChild, VizMachine } from "../schema.ts";
import { drawChildMarkers, type MarkerContext } from "./markers.ts";

const NS = "http://www.w3.org/2000/svg";

function board(widths: ReadonlyArray<number>): SVGSVGElement {
  const root = document.createElementNS(NS, "svg");
  widths.forEach((width, index) => {
    const state = document.createElementNS(NS, "g");
    state.setAttribute("data-node-id", `p.s${index}`);
    const row = document.createElementNS(NS, "rect");
    row.setAttribute("class", "worker-row");
    row.setAttribute("x", "10");
    row.setAttribute("y", String(index * 50));
    row.setAttribute("width", String(width));
    row.setAttribute("height", "14");
    state.append(row);
    root.append(state);
  });
  document.body.append(root);
  return root;
}

const machine = { states: [] } as unknown as VizMachine;

function child(key: string, state: string): VizLiveChild {
  return { map: "p", key, state: `p.${state}`, since: 0 };
}

function context(children: VizLiveChild[], over: Partial<MarkerContext> = {}): MarkerContext {
  return { machine, children, picked: null, motion: false, onPick: () => undefined, ...over };
}

const markers = (root: SVGSVGElement) =>
  Array.from(root.querySelectorAll<SVGGElement>("g.child-marker"));

describe("drawChildMarkers", () => {
  test("a chip per child on its state", () => {
    const root = board([168, 168]);
    drawChildMarkers(root, context([child("w1", "s0"), child("w2", "s0"), child("w3", "s1")]));
    expect(
      markers(root).map((each) => `${each.dataset.markerKey}@${each.dataset.markerState}`),
    ).toEqual(["w1@p.s0", "w2@p.s0", "w3@p.s1"]);
  });

  test("a click or Enter on a chip picks that child", () => {
    const root = board([168]);
    const picked: Array<{ map: string; key: string }> = [];
    drawChildMarkers(
      root,
      context([child("w1", "s0"), child("w2", "s0")], { onPick: (each) => picked.push(each) }),
    );
    const second = markers(root)[1];
    second?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    second?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    second?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(picked).toEqual([
      { map: "p", key: "w2" },
      { map: "p", key: "w2" },
    ]);
    drawChildMarkers(
      root,
      context([child("w1", "s0"), child("w2", "s0")], { picked: picked[0] ?? null }),
    );
    expect(markers(root).map((each) => each.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
  });

  test("a child that moves keeps its element", () => {
    const root = board([168, 168]);
    drawChildMarkers(root, context([child("w1", "s0")]));
    const before = markers(root)[0];
    drawChildMarkers(root, context([child("w1", "s1")], { motion: true }));
    expect(markers(root)).toEqual([before]);
    expect(before?.dataset.markerState).toBe("p.s1");
  });

  test("a child that is gone loses its chip", () => {
    const root = board([168]);
    drawChildMarkers(root, context([child("w1", "s0"), child("w2", "s0")]));
    drawChildMarkers(root, context([child("w2", "s0")]));
    expect(markers(root).map((each) => each.dataset.markerKey)).toEqual(["w2"]);
  });

  test("property: every chip lies in its row and every child is a chip or in a +N title", () => {
    const key = fc.string({ maxLength: 20 });
    fc.assert(
      fc.property(
        fc.integer({ min: 168, max: 400 }),
        fc.integer({ min: 168, max: 400 }),
        fc.array(fc.tuple(key, fc.constantFrom("s0", "s1")), { maxLength: 30 }),
        (w0, w1, raw) => {
          const seen = new Set<string>();
          const kids = raw
            .filter(([k, s]) => !seen.has(k) && seen.add(k))
            .filter(([k]) => !k.includes(", "))
            .map(([k, s]) => child(k, s));
          const root = board([w0, w1]);
          drawChildMarkers(root, context(kids));
          const widthOf = [w0, w1];
          for (const marker of markers(root)) {
            const at = /translate\(([-\d.]+)px/.exec(marker.style.transform);
            const left = Number(at?.[1]);
            const shape = marker.querySelector(
              marker.classList.contains("dot") ? "rect.hit" : "rect",
            );
            const index = marker.dataset.markerState === "p.s0" ? 0 : 1;
            expect(left).toBeGreaterThanOrEqual(10 - 0.1);
            expect(left + Number(shape?.getAttribute("width"))).toBeLessThanOrEqual(
              10 + (widthOf[index] ?? 0) + 0.1,
            );
          }
          const drawn = new Set(
            markers(root).map((m) => `${m.dataset.markerState}|${m.dataset.markerKey}`),
          );
          const hidden = new Set(
            Array.from(root.querySelectorAll("text.marker-count")).flatMap((node) =>
              (node.querySelector("title")?.textContent ?? "")
                .split(", ")
                .map((k) => `${(node as SVGElement).dataset.markerState}|${k}`),
            ),
          );
          for (const each of kids) {
            const id = `${each.state}|${each.key}`;
            expect(drawn.has(id) || hidden.has(id)).toBe(true);
          }
          root.remove();
        },
      ),
      { numRuns: 200, seed: 0x710 },
    );
  });
});
