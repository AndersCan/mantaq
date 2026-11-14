// Run after the docs build, from the repo root: node scripts/ai-label-check.mjs
// Every built docs page: 🤖 before the h1 and on its own sidebar link iff its source is not `author: human`.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const docs = "apps/docs/src/content/docs";
const dist = "apps/docs/dist";
const failures = [];
let checked = 0;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.mdx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

for (const file of walk(docs)) {
  const src = readFileSync(file, "utf8");
  const front = src.split("---")[1] ?? "";
  if (/^template:\s*splash/m.test(front)) continue;
  const slug = file
    .slice(docs.length + 1)
    .replace(/\.mdx?$/, "")
    .replace(/(^|\/)index$/, "");
  const html = join(dist, slug, "index.html");
  if (!existsSync(html)) continue;
  const page = readFileSync(html, "utf8");
  const h1 = page.match(/<h1 id="_top"[^>]*>(.*?)<\/h1>/s)?.[1];
  if (h1 === undefined) continue; // redirect stub
  const title = h1
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  checked++;
  const ai = !/^author:\s*human\s*$/m.test(front);
  if (title.startsWith("🤖 ") !== ai) failures.push(`${slug}: title "${title}" (ai=${ai})`);
  const link = page.match(
    new RegExp(`href="/mantaq/${slug}${slug ? "/" : ""}"[^>]*>(.*?)</a>`, "s"),
  );
  if (link && /sl-badge[^>]*>🤖/.test(link[1]) !== ai)
    failures.push(`${slug}: sidebar badge (ai=${ai})`);
}

if (checked === 0) failures.push("no built pages found: run the docs build first");
console.log(failures.length ? failures.join("\n") : `ok: ${checked} pages`);
process.exit(failures.length ? 1 : 0);
