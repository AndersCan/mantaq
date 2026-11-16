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
  expect(listed(".viz .selected .frame")).toMatch(/stroke:\s*var\(--select\)/);
  const override = css.lastIndexOf(".viz .graph .selected path");
  expect(override).toBeGreaterThan(css.indexOf(".viz .edge.sent path"));
  expect(override).toBeGreaterThan(css.indexOf(".viz .current .frame"));
  expect(listed(".viz .graph .selected path")).toMatch(/stroke:\s*var\(--select\)/);
  expect(listed(".viz .state:focus-visible .frame")).toMatch(/stroke:\s*var\(--select\)/);
});

test("the active state and the next arrows use the accent, and the arrows do not move", () => {
  expect(listed(".viz .current .frame")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz .next path")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz .next path")).not.toMatch(/animation/);
  expect(rule(".viz .next path")).not.toMatch(/stroke-dasharray/);
  expect(css).not.toMatch(/@keyframes/);
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

test("the panel stays below the graph at every width", () => {
  expect(css).not.toContain("@container");
  const main = bare.split("}").find((b) => b.trim().startsWith(".viz .viz-main {")) ?? "";
  expect(main).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  expect(rule(".viz .panel {")).not.toMatch(/sticky/);
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
