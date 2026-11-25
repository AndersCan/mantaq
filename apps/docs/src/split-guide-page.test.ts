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
const before = 'title="order.ts before the split"';
const blocks = [...page.matchAll(/^```ts(.*)\n([\s\S]*?)^```$/gm)];
/** Every ts block of the guide is an excerpt, except the machine before the split. */
const excerptBlocks = blocks.filter((block) => block[1]?.trim() !== before);
const excerpts = excerptBlocks.map((block) => block[2] ?? "");

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
  expect({ excerpts: excerpts.length, skipped: blocks.length - excerpts.length }).toStrictEqual({
    excerpts: 3,
    skipped: 1,
  });
  expect(excerpts.filter((excerpt) => !isFromSource(excerpt))).toStrictEqual([]);
});
