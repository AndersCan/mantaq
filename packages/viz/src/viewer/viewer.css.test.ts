import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const css = readFileSync(new URL("./viewer.css", import.meta.url), "utf8");
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
  expect(block).toMatch(/\.child-marker > :not\(title\)/);
  expect(block).toMatch(/transition:\s*none/);
  expect(block).toMatch(/animation:\s*none/);
});
