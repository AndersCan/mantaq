import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const css = readFileSync(new URL("./viewer.css", import.meta.url), "utf8");
const bare = css.replace(/\/\*[^]*?\*\//g, "");
const rule = (selector: string) =>
  css.split("}").find((block) => block.trim().startsWith(selector)) ?? "";

test("marker keys drop the diagram's text outline so they stay readable", () => {
  expect(rule(".viz .child-marker text")).toMatch(/stroke:\s*none/);
});

test("a new marker grows around its own centre, not the view-box", () => {
  const entering = rule(".viz .child-marker.entering");
  expect(entering).toMatch(/transform-box:\s*fill-box/);
  expect(entering).toMatch(/transform-origin:\s*center/);
});

test("reduced motion switches off the slide and the grow-in after the marker rules", () => {
  const media = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  expect(media).toBeGreaterThan(css.indexOf(".viz .child-marker.entering"));
  expect(media).toBeGreaterThan(css.indexOf("transition: transform 250ms"));
  const block = css.slice(media);
  expect(block).toContain(".viz .child-markers .child-marker > :not(title)");
  expect(block).toContain(".viz .child-markers .child-marker,");
  expect(block).toMatch(/transition:\s*none/);
  expect(block).toMatch(/animation:\s*none/);
});

test("a picked or focused child marker is outlined in the select colour", () => {
  expect(rule('.viz .child-marker[aria-pressed="true"] rect:not(.hit)')).toMatch(
    /stroke:\s*var\(--select\)/,
  );
  expect(rule(".viz .child-marker:focus-visible rect:not(.hit)")).toMatch(
    /stroke:\s*var\(--select\)/,
  );
});

test("the active walk uses the accent and controls do not", () => {
  expect(rule(".viz .next path")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz .edge.sent path")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz button.primary")).not.toMatch(/--accent|--select/);
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
  expect(override).toBeGreaterThan(css.indexOf(".viz .running path"));
  expect(override).toBeGreaterThan(css.indexOf(".viz .current .frame"));
  expect(listed(".viz .graph .selected path")).toMatch(/stroke:\s*var\(--select\)/);
  expect(listed(".viz .state:focus-visible .frame")).toMatch(/stroke:\s*var\(--select\)/);
});

test("the active state, running edge and composing edge use the accent", () => {
  expect(listed(".viz .taken path")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz .running path")).toMatch(/stroke:\s*var\(--accent\)/);
  expect(rule(".viz .edge[data-composing] path")).toMatch(/stroke:\s*var\(--accent\)/);
});

test("tabs and the help link follow the host's text size", () => {
  expect(rule('.viz .tab-strip [role="tab"]')).toMatch(/font-size:\s*1em/);
  expect(rule(".viz .help-link")).toMatch(/font-size:\s*1em/);
});
