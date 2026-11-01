/** Pure helpers for the bump:check gate. */

export function extractBumpNames(source) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  if (end === -1) return [];
  const names = [];
  for (const line of lines.slice(1, end)) {
    const key = /^(?:"([^"]+)"|'([^']+)'|([^\s:#"']+))\s*:/.exec(line);
    if (key === null) continue;
    const name = key[1] ?? key[2] ?? key[3];
    if (!name.startsWith("$")) names.push(name);
  }
  return names;
}

export function findUnknownNames({ source, known }) {
  return extractBumpNames(source).filter((name) => !known.has(name));
}
