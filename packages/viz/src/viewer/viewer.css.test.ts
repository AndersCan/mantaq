import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const css = readFileSync(new URL("./viewer.css", import.meta.url), "utf8");
const bare = css.replace(/\/\*[^]*?\*\//g, "");
const rule = (selector: string) =>
  css.split("}").find((block) => block.trim().startsWith(selector)) ?? "";

test("the active walk uses the accent and controls do not", () => {
  expect(rule(".viz .next path")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz button:focus-visible")).not.toMatch(/--accent/);
});

const listed = (selector: string) =>
  bare.split("}").find((block) =>
    block
      .split("{")[0]
      .split(",")
      .some((s) => s.trim() === selector),
  ) ?? "";

test("a clicked item is teal and stays teal over the walk colours", () => {
  expect(listed(".viz .graph .selected .frame")).toMatch(/stroke:\s*var\(--select\)/);
  const override = css.lastIndexOf(".viz .graph .selected path");
  expect(override).toBeGreaterThan(css.indexOf(".viz .edge.sent path"));
  expect(override).toBeGreaterThan(css.indexOf(".viz .current .frame"));
  expect(listed(".viz .graph .selected path")).toMatch(/stroke:\s*var\(--select\)/);
  expect(listed(".viz .state:focus-visible .frame")).toMatch(/stroke:\s*var\(--select\)/);
});

test("the active state and the next arrows use the accent, and the arrows move", () => {
  expect(listed(".viz .current .frame")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz .next path")).toMatch(/stroke:\s*var\(--accent\)/);
  const next = listed('.viz .edge.next[role="button"] path');
  expect(next).toMatch(/animation:\s*viz-march/);
  expect(next).toMatch(/stroke-dasharray:\s*8 5/);
  expect(bare).toMatch(/@keyframes viz-march/);
  const reduced = bare.slice(bare.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(reduced).toMatch(/\.viz \.edge\.next\[role="button"\] path\s*\{[^}]*animation:\s*none/);
  const at = bare.indexOf('.viz .edge.next[role="button"] path');
  expect(at).toBeGreaterThan(bare.indexOf(".viz .edge.stay path"));
  expect(at).toBeGreaterThan(bare.indexOf(".viz .edge.internal path"));
});

test("tabs follow the host's text size", () => {
  expect(rule('.viz .tab-strip [role="tab"]')).toMatch(/font-size:\s*1em/);
});

test("buttons follow the host's text size", () => {
  expect(css).toMatch(/\n\.viz button \{[^}]*font-size:\s*1em/);
  expect(rule(".viz :where(button, select")).toMatch(/font-size:\s*1em/);
});

test("a dropped message's Step line uses the banner colour", () => {
  const bareRule = (selector: string) =>
    bare.split("}").find((block) => block.trim().startsWith(selector)) ?? "";
  expect(bareRule(".viz [data-live-dropped]")).toMatch(/color:\s*var\(--banner-fg\)/);
});

test("the panel stays below the graph and in view while the graph scrolls", () => {
  expect(css).not.toContain("@container");
  const main = bare.split("}").find((b) => b.trim().startsWith(".viz .viz-main {")) ?? "";
  expect(main).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  const panel = rule(".viz .panel {");
  expect(panel).toMatch(/position:\s*sticky/);
  expect(panel).toMatch(/bottom:\s*0/);
  expect(panel).toMatch(/background:\s*var\(--bg\)/);
  expect(panel).not.toMatch(/(^|[\s;{])top:/);
  const tabPanel = rule(".viz .tab-panel {");
  expect(tabPanel).toMatch(/overflow:\s*auto/);
  expect(tabPanel).toMatch(/max-height:\s*25vh/);
  expect(rule('.viz .tab-panel[data-tab-panel="screen"]')).toMatch(/max-height:\s*60vh/);
});

test("a diagram wider than its canvas scrolls sideways, never clips", () => {
  const canvas = bare
    .split("}")
    .filter((block) =>
      block
        .split("{")[0]
        .split(",")
        .some((s) => s.trim() === ".viz .canvas"),
    )
    .join("}");
  expect(canvas).toMatch(/overflow:\s*auto;/);
  // Every rule for the canvas, not only the first: a later overflow(-x) that is not auto/scroll cuts the diagram off.
  for (const [, value] of canvas.matchAll(/overflow(?:-x)?:\s*([a-z]+)/g)) {
    expect(value).toMatch(/^(auto|scroll)$/);
  }
});

test("a child chip never slides: no child-marker rule has a transition", () => {
  const rules = bare.split("}").filter((block) => block.split("{")[0].includes("child-marker"));
  expect(rules.length).toBeGreaterThan(0);
  for (const block of rules) expect(block).not.toMatch(/transition/);
});

test("an arrow's hit path is a wide transparent stroke that takes the pointer", () => {
  const css = readFileSync(new URL("./viewer.css", import.meta.url), "utf8");
  const rule = /\.viz \.graph \.edge path\.hit \{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toContain("stroke: transparent");
  expect(rule).toContain("pointer-events: stroke");
  // Dashed and dotted arrows: without this the hit path takes their dashes and misses in the gaps.
  expect(rule).toContain("stroke-dasharray: none");
  expect(Number(/stroke-width: (\d+)/.exec(rule)?.[1])).toBeGreaterThanOrEqual(10);
});

test("in full screen the diagram widens to fill the screen but keeps its label floor", () => {
  expect(rule(".viz:fullscreen .graph")).toMatch(
    /width:\s*max\(var\(--graph-floor\),\s*100%\)\s*!important/,
  );
});

test("the next arrows march one dash period forever; only reduced motion stops them", () => {
  const next = listed('.viz .edge.next[role="button"] path');
  const [dash, gap] = (next.match(/stroke-dasharray:\s*(\d+)\s+(\d+)/) ?? []).slice(1).map(Number);
  expect(next).toMatch(/animation:\s*viz-march\s+[\d.]+m?s\s+linear\s+infinite/);
  expect(bare).toMatch(
    new RegExp(
      `@keyframes viz-march\\s*\\{\\s*to\\s*\\{\\s*stroke-dashoffset:\\s*-${(dash ?? 0) + (gap ?? 0)};`,
    ),
  );
  const reduced =
    bare.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.viz \.edge\.next\[role="button"\] path\s*\{\s*animation:\s*none;\s*\}\s*\}/g,
    ) ?? [];
  expect(reduced).toHaveLength(1);
  expect(bare.replace(reduced[0] ?? "", "")).not.toMatch(/animation:\s*none/);
});

test("a focused arrow or state scrolls clear of the pinned panel", () => {
  expect(rule(".viz .canvas [tabindex] {")).toMatch(
    /scroll-margin-bottom:\s*calc\(60vh \+ \d+px\)/,
  );
});

test("a chip's hit rect is transparent, takes the pointer, and no chip paint rule reaches it", () => {
  const hit = listed(".viz .child-marker .marker-hit");
  expect(hit).toMatch(/fill:\s*transparent/);
  expect(hit).toMatch(/stroke:\s*none/);
  expect(hit).toMatch(/pointer-events:\s*all/);
  const paints = bare
    .split("}")
    .map((block) => block.split("{")[0].trim())
    .filter((selector) => selector.includes("child-marker") && /\brect\b/.test(selector));
  for (const selector of paints) expect(selector).toContain("rect:not(.marker-hit)");
});

test("the queue takes the pointer, so its title shows on hover", () => {
  expect(listed(".viz .queue")).toMatch(/cursor:\s*default/);
  expect(listed(".viz .queue")).not.toMatch(/pointer-events:\s*none/);
});

/** Each compound selector naming a state or an arrow (`.state`, `.edge`, never `.edge-help`). */
function stateOrArrowParts(selector: string): string[] {
  return selector.split(/[\s>+~]+/).filter((part) => /\.(state|edge)(?![\w-])/.test(part));
}

test("a pointer, a hover style or the march on a state or an arrow needs it to be a button", () => {
  const offending: string[] = [];
  for (const block of bare.split("}")) {
    const parts = block.split("{");
    const body = parts.at(-1) ?? "";
    const head = parts.at(-2) ?? "";
    const pointer = /cursor:\s*pointer|animation:\s*viz-march/.test(body);
    for (const selector of head.split(",").map((each) => each.trim())) {
      const looksClickable = pointer || selector.includes(":hover");
      const parts = stateOrArrowParts(selector);
      const gated = parts.every((part) => part.includes('[role="button"]'));
      if (looksClickable && !gated) offending.push(selector);
    }
  }
  expect({ offending, gated: listed('.viz .edge[role="button"]') }).toEqual({
    offending: [],
    gated: expect.stringMatching(/cursor:\s*pointer/),
  });
});
