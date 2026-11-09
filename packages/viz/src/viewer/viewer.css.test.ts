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
