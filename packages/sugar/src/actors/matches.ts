import type { Snapshot } from "@mantaq/core";

export interface MatchTarget {
  snapshot(): Snapshot;
}

function matchFrom(patternParts: string[]) {
  function matchRegion(options: { snapshot: Snapshot; index: number }): boolean {
    const stateName = options.snapshot.path[0];

    for (let end = options.index; end < patternParts.length; end++) {
      const candidate = patternParts.slice(options.index, end + 1).join(".");
      if (candidate !== stateName) continue;

      if (end === patternParts.length - 1) return true;

      const regionSnap = options.snapshot.regions[patternParts[end + 1]];
      if (!regionSnap) return false;

      if (end + 1 === patternParts.length - 1) return true;

      return matchRegion({ snapshot: regionSnap, index: end + 2 });
    }

    return false;
  }
  return matchRegion;
}

/**
 * True when the actor's snapshot matches the dotted pattern. Accepts the
 * pattern as one dotted string or as separate segments. A segment containing
 * dots matches states whose own name contains dots.
 */
export function matches(actor: MatchTarget, ...pattern: [pattern: string]): boolean {
  const joined = pattern.join(".");
  if (!joined || joined.endsWith(".") || joined.startsWith(".") || joined.includes("..")) {
    return false;
  }
  return matchFrom(joined.split("."))({ snapshot: actor.snapshot(), index: 0 });
}
