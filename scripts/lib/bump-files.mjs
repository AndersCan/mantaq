/** Pure helpers for the bump:check gate. */

/** `{ name, level }` per frontmatter entry; reserved `$` keys skipped. */
function extractBumps(source) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  if (end === -1) return [];
  const bumps = [];
  for (const line of lines.slice(1, end)) {
    const key = /^(?:"([^"]+)"|'([^']+)'|([^\s:#"']+))\s*:\s*["']?([\w-]*)/.exec(line);
    if (key === null) continue;
    const name = key[1] ?? key[2] ?? key[3];
    if (!name.startsWith("$")) bumps.push({ name, level: key[4] });
  }
  return bumps;
}

export function extractBumpNames(source) {
  return extractBumps(source).map((bump) => bump.name);
}

export function findUnknownNames({ source, known }) {
  return extractBumpNames(source).filter((name) => !known.has(name));
}

/**
 * Packages a bump file would take to a new major. Mantaq stays on 0.x: a
 * breaking change is a minor bump (0.5 → 0.6). `@mantaq/sugar` and
 * `@mantaq/test` reached 2.x by mistake; this keeps it from happening again.
 */
export function findMajorBumps(source) {
  return extractBumps(source)
    .filter((bump) => bump.level === "major")
    .map((bump) => bump.name);
}
