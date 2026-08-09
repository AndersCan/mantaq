import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../packages/core/package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(path, "utf8"));
const main = pkg.exports["."] ?? "./dist/index.mjs";
pkg.exports = {
  ".": main,
  "./internal": "./src/internal-registry.ts",
  "./package.json": "./package.json",
};
writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
