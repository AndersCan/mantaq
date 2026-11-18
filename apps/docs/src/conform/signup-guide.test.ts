import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the guide copies the sample folder that exists", () => {
  expect(read("../content/docs/guides/app-without-mantaq.mdx")).toContain(
    "npx degit AndersCan/mantaq/apps/docs/src/conform/signup-page",
  );
  expect(read("./signup-page/index.html")).toContain("<form");
});

test("the ask names the files the check looks for", () => {
  const ask = read("./signup-ask.txt");
  for (const name of ["index.html", "signup-model.ts", "signup.spec.ts", "npx playwright test"]) {
    expect(ask).toContain(name);
  }
});
