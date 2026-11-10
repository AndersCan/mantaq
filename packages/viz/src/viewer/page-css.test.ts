import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const importsPageCss = (name: string) => /^import "\.\/page\.css";$/m.test(source(name));

describe("page.css", () => {
  it("embeds that import @mantaq/viz/page get no page chrome", () => {
    expect(importsPageCss("page.ts")).toBe(false);
  });

  it.each(["live.ts"])("%s brings the page chrome itself", (name) => {
    expect(importsPageCss(name)).toBe(true);
  });
});
