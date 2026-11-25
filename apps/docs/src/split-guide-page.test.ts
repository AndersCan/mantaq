import { expect, test } from "vite-plus/test";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const order = join(import.meta.dirname, "../../../packages/examples/order");
const sources = [
  "order.ts",
  "payment.ts",
  "delivery.ts",
  "order.test.ts",
  "order.error.test.ts",
].map((file) => flat(readFileSync(join(order, file), "utf8")));
const page = readFileSync(
  join(import.meta.dirname, "content/docs/guides/split-a-big-machine.mdx"),
  "utf8",
);
/** Code blocks of the guide; a block with a title (the machine before the split) is not an excerpt. */
const excerpts = [...page.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((match) => match[1] ?? "");

/** The code on one line, so the line width of the formatter does not count. */
function flat(code: string): string {
  return code
    .replaceAll(/\s+/g, " ")
    .replaceAll(/([([{]) /g, "$1")
    .replaceAll(/,? ([)\]}])/g, "$1")
    .trim();
}

/** True when each part of `excerpt` between `// ...` lines is in one source file, in order. */
function isFromSource(excerpt: string): boolean {
  const parts = excerpt.split(/^\s*\/\/ \.\.\.$/m).map((part) => flat(part));
  return sources.some((source) => {
    let from = 0;
    return parts.every((part) => {
      const at = source.indexOf(part, from);
      if (at === -1) return false;
      from = at + part.length;
      return true;
    });
  });
}

test("each code excerpt of the split guide is in the order example source", () => {
  expect(excerpts.length).toBeGreaterThan(0);
  expect(excerpts.filter((excerpt) => !isFromSource(excerpt))).toStrictEqual([]);
});
