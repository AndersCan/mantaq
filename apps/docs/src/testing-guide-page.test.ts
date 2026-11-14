import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@mantaq/core";
import { createTestHarness } from "@mantaq/test";
import { expect, test } from "vite-plus/test";
import * as checkout from "./content/docs/checkout.ts";

const page = readFileSync(
  join(import.meta.dirname, "content/docs/guides/testing-guide.mdx"),
  "utf8",
);
const code = [...page.matchAll(/```ts\n([\s\S]*?)```/g)]
  .map((m) => m[1] ?? "")
  .join("\n")
  .replace(/^import .*$/gm, "");

test("the testing guide's code runs against the checkout machine", async () => {
  const scope = { ...core, ...checkout, createTestHarness };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction(...Object.keys(scope), code);
  await expect(run(...Object.values(scope))).resolves.toBeUndefined();
});

test("the testing guide's method list matches the harness signatures", () => {
  expect(page).not.toMatch(
    /assertStateVisited\(id\)|assertTransitionVisited\(from, eventId\)|assertEffectRan\(id\)|assertContextNever\(predicate\)/,
  );
});
