/** Pure source-text extractors shared by the docs:check gates. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else if (entry.endsWith(".mdx")) out.push(full);
  }
  return out;
}

export function read(file) {
  return readFileSync(file, "utf8");
}

export function extractIds(source) {
  const ids = new Set();
  for (const match of source.matchAll(/state\("([^"]+)"\)/g)) ids.add(match[1]);
  for (const match of source.matchAll(/event\("([^"]+)"\)/g)) ids.add(match[1]);
  for (const match of source.matchAll(/(?:states|events)\("([^"]+)"\)/g)) ids.add(match[1]);
  for (const match of source.matchAll(/(?:states|events)\("[^"]+"(,\s*"([^"]+)"\s*)+\)/g)) {
    for (const arg of match[0].matchAll(/"([^"]+)"/g)) ids.add(arg[1]);
  }
  for (const match of source.matchAll(/matches\(\s*[^,]+,\s*"([^"]+)"/g)) {
    for (const token of match[1].split(".")) ids.add(token);
  }
  return ids;
}

export function extractExports(file) {
  const source = read(file);
  const exports = new Set();
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const raw of match[1].split(",")) {
      let name = raw.trim().replace(/^type\s+/, "");
      name = name.split(" as ")[0].trim();
      if (name) exports.add(name);
    }
  }
  for (const match of source.matchAll(
    /export\s+(?:type\s+)?(?:class|function|const|interface|type)\s+(\w+)/g,
  )) {
    exports.add(match[1]);
  }
  return exports;
}

export function extractImports(source) {
  const imports = new Map();
  for (const match of source.matchAll(/import\s+type\s*\{([^}]+)\}\s*from\s*"(@mantaq\/[^"]+)"/g)) {
    for (const name of splitImportNames(match[1])) {
      if (!imports.has(match[2])) imports.set(match[2], new Set());
      imports.get(match[2]).add(name);
    }
  }
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(@mantaq\/[^"]+)"/g)) {
    for (const name of splitImportNames(match[1])) {
      if (!imports.has(match[2])) imports.set(match[2], new Set());
      imports.get(match[2]).add(name);
    }
  }
  return imports;
}

function splitImportNames(list) {
  return list
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .map((s) => s.split(" as ")[0].trim())
    .filter(Boolean);
}
