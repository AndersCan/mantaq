/** Pure helpers for the bump:check gate. */

export function extractBumpNames(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (match === null) return [];
  const names = [];
  for (const line of match[1].split(/\r?\n/)) {
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
