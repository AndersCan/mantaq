// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import fc from "fast-check";
import type { VizLiveChild } from "../schema.ts";
import { textWidth } from "./layout.ts";
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

function child(key: string, state: string): VizLiveChild {
  return { map: "p", key, state: `p.${state}`, since: 0 };
}

function context(children: VizLiveChild[], over: Partial<MarkerContext> = {}): MarkerContext {
  return { children, followedLook: "current", onPick: () => undefined, ...over };
}

const markers = (root: SVGSVGElement) =>
  Array.from(root.querySelectorAll<SVGGElement>("g.child-marker"));

describe("drawChildMarkers", () => {
  test("chips and +N stay inside the row when the shown count is wider than the total", () => {
    // textWidth("+22", 10) = 20 but textWidth("+10", 10) = 21: room kept for "+22" is too small for "+10".
    const root = board([168]);
    drawChildMarkers(
      root,
      context(Array.from({ length: 22 }, (_, i) => child(`k${String(i).padStart(2, "0")}`, "s0"))),
    );
    const lefts = markers(root).map((m) =>
      Number(/translate\(([-\d.]+)px/.exec(m.style.transform)?.[1]),
    );
    expect(root.querySelector("text.marker-count")?.lastChild?.textContent).toBe(
      `+${22 - lefts.length}`,
    );
    expect(Math.min(...lefts)).toBeGreaterThanOrEqual(10);
    root.remove();
  });

  test("chips that fit exactly show without a +N", () => {
    // 5 chips "k0".."k4" = (14 + 13 * 3 + 14) + 5 * 10 + 4 * 4 = 133: no count on 168 or on exactly 133.
    const root = board([168]);
    drawChildMarkers(root, context(Array.from({ length: 5 }, (_, i) => child(`k${i}`, "s0"))));
    expect(markers(root)).toHaveLength(5);
    expect(root.querySelector("text.marker-count")).toBeNull();
    root.remove();
    const exact = board([133]);
    drawChildMarkers(exact, context(Array.from({ length: 5 }, (_, i) => child(`k${i}`, "s0"))));
    expect(markers(exact)).toHaveLength(5);
    expect(exact.querySelector("text.marker-count")).toBeNull();
    exact.remove();
  });

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
    const looks: Array<{ button: boolean; current: boolean }> = [];
    for (const marker of markers(root)) {
      looks.push({
        button: marker.getAttribute("role") === "button",
        current: marker.getAttribute("aria-current") === "true",
      });
    }
    expect(looks).toEqual([
      { button: true, current: false },
      { button: false, current: true },
    ]);
  });

  test("a chip's click area reaches past its pill", () => {
    const root = board([168, 168]);
    drawChildMarkers(root, context([child("w1", "s0")]));
    const pill = markers(root)[0]?.querySelector("rect");
    const hit = markers(root)[0]?.querySelector("rect.marker-hit");
    expect(Number(hit?.getAttribute("width"))).toBeGreaterThan(Number(pill?.getAttribute("width")));
    expect(Number(hit?.getAttribute("height"))).toBeGreaterThan(
      Number(pill?.getAttribute("height")),
    );
  });

  test("a chip's click area stops before its neighbour's pill", () => {
    const root = board([168]);
    drawChildMarkers(root, context([child("w1", "s0"), child("w2", "s0")]));
    const [first, second] = markers(root);
    const left = (m: SVGGElement | undefined) =>
      Number(/translate\(([-\d.]+)px/.exec(m?.style.transform ?? "")?.[1]);
    const attr = (m: SVGGElement | undefined, selector: string, name: string) =>
      Number(m?.querySelector(selector)?.getAttribute(name));
    const firstPillEnd = left(first) + attr(first, "rect:not(.marker-hit)", "width");
    const firstHitEnd =
      left(first) + attr(first, "rect.marker-hit", "x") + attr(first, "rect.marker-hit", "width");
    const secondHitStart = left(second) + attr(second, "rect.marker-hit", "x");
    expect(secondHitStart).toBeGreaterThanOrEqual(firstPillEnd);
    expect(secondHitStart).toBeGreaterThanOrEqual(firstHitEnd - 0.01);
    root.remove();
  });

  test("a child that moves keeps its element", () => {
    const root = board([168, 168]);
    drawChildMarkers(root, context([child("w1", "s0")]));
    const before = markers(root)[0];
    drawChildMarkers(root, context([child("w1", "s1")]));
    expect(markers(root)).toEqual([before]);
    expect(before?.dataset.markerState).toBe("p.s1");
    const fresh = board([168, 168]);
    drawChildMarkers(fresh, context([child("w1", "s1")]));
    expect(before?.style.transform).toBe(markers(fresh)[0]?.style.transform);
    expect(before?.style.transform).not.toBe("");
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
        fc.array(fc.tuple(key, fc.constantFrom("s0", "s1")), { maxLength: 40, size: "max" }),
        (w0, w1, raw) => {
          const seen = new Set<string>();
          const kids = raw
            .filter(([k, s]) => !seen.has(k) && seen.add(k))
            .map(([k, s]) => child(k, s));
          const root = board([w0, w1]);
          drawChildMarkers(root, context(kids));
          const widthOf = [w0, w1];
          for (const marker of markers(root)) {
            const at = /translate\(([-\d.]+)px/.exec(marker.style.transform);
            const left = Number(at?.[1]);
            const shape = marker.querySelector("rect");
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
                .split("\n")
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
      { numRuns: 200, seed: 0x710, endOnFailure: true },
    );
  });
});

describe("drawChildMarkers branches", () => {
  const keys = (n: number) => Array.from({ length: n }, (_, index) => `w${index + 1}`);
  const at = (marker: Element | undefined) =>
    Number(/translate\(([-\d.]+)px/.exec((marker as SVGGElement).style.transform)?.[1]);

  test("more children than fit: pills, then a +N whose title lists each hidden key on its own line, in key order", () => {
    const root = board([152]);
    const all = [...keys(19), "z, y"].map((key) => child(key, "s0")).reverse();
    drawChildMarkers(root, context(all));
    const drawn = markers(root);
    expect(
      drawn.every((each) => each.querySelector("text")?.textContent === each.dataset.markerKey),
    ).toBe(true);
    const count = root.querySelector("text.marker-count");
    const hidden = count?.querySelector("title")?.textContent?.split("\n") ?? [];
    expect(count?.textContent?.endsWith(`+${hidden.length}`)).toBe(true);
    expect([...drawn.map((each) => each.dataset.markerKey), ...hidden]).toEqual([
      ...keys(19),
      "z, y",
    ]);
    expect(at(count ?? undefined)).toBeGreaterThan(at(drawn.at(-1)));
    expect(at(count ?? undefined)).toBeLessThan(10 + 152);
  });

  test("seven short keys on a 400 row are seven pills, centred", () => {
    const root = board([400]);
    drawChildMarkers(root, context(keys(7).map((key) => child(key, "s0"))));
    const pills = markers(root);
    expect(pills).toHaveLength(7);
    expect(root.querySelector("text.marker-count")).toBeNull();
    const end =
      at(pills.at(-1)) + Number(pills.at(-1)?.querySelector("rect")?.getAttribute("width"));
    expect(Math.abs(at(pills[0]) - 10 - (10 + 400 - end))).toBeLessThan(0.2);
  });

  test("pills and a +N are centred as one group, a 4 gap before the +N", () => {
    // 6 keys "k0".."k5" on a 133 row: 5 pills fill it, so 4 pills (105) + 4 + "+2" are centred.
    const root = board([133]);
    drawChildMarkers(root, context(Array.from({ length: 6 }, (_, i) => child(`k${i}`, "s0"))));
    const pills = markers(root);
    const count = root.querySelector("text.marker-count");
    expect(pills).toHaveLength(4);
    const end =
      at(pills.at(-1)) + Number(pills.at(-1)?.querySelector("rect")?.getAttribute("width"));
    expect(Math.abs(at(count ?? undefined) - end - 4)).toBeLessThan(0.1);
    const right = at(count ?? undefined) + textWidth("+2", 10);
    expect(Math.abs(at(pills[0]) - 10 - (10 + 133 - right))).toBeLessThan(0.2);
  });

  test("a pill shows a long key cut to 8 characters and an empty key as two quotes", () => {
    const root = board([400]);
    drawChildMarkers(root, context([child("abcdefghij", "s0"), child("", "s0")]));
    expect(markers(root).map((each) => each.querySelector("text")?.textContent)).toEqual([
      '""',
      "abcdefg…",
    ]);
    expect(markers(root).map((each) => each.getAttribute("aria-label"))).toEqual([
      '"", in s0',
      "abcdefghij, in s0",
    ]);
  });

  test("chips are in key order, centred in the row, and a state without a row draws none", () => {
    const root = board([168]);
    drawChildMarkers(root, context([child("w10", "s0"), child("w2", "s0"), child("w1", "s9")]));
    const drawn = markers(root);
    expect(drawn.map((each) => each.dataset.markerKey)).toEqual(["w2", "w10"]);
    const right = drawn.at(-1)?.querySelector("rect");
    const end = at(drawn.at(-1)) + Number(right?.getAttribute("width"));
    expect(Math.abs(at(drawn[0]) - 10 - (10 + 168 - end))).toBeLessThan(0.2);
  });

  test("Space picks and keeps the page from scrolling", () => {
    const root = board([168]);
    const picked: string[] = [];
    drawChildMarkers(
      root,
      context([child("w1", "s0")], { onPick: (each) => picked.push(each.key) }),
    );
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    markers(root)[0]?.dispatchEvent(space);
    expect(picked).toEqual(["w1"]);
    expect(space.defaultPrevented).toBe(true);
  });
});
