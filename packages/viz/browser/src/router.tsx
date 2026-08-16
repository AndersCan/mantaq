/**
 * Fixture router — `?fixture=<id>&theme=light|dark`.
 *
 * Navigation is a full reload: every fixture loads a FRESH actor and runs its
 * pre-script before mount, so the rendered graph is a pure function of the
 * URL (plan §8).
 */

import type { FixtureTheme } from "../fixtures/index.ts";

export interface RouteState {
  fixtureId: string;
  theme: FixtureTheme;
}

const DEFAULT_FIXTURE = "checkout";

export function parseRoute(search: string): RouteState {
  const params = new URLSearchParams(search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  return { fixtureId: params.get("fixture") ?? DEFAULT_FIXTURE, theme };
}

export function fixtureHref(fixtureId: string, theme: FixtureTheme): string {
  const params = new URLSearchParams({ fixture: fixtureId, theme });
  return `?${params.toString()}`;
}
