// @vitest-environment happy-dom
import { exampleCases, fixtureCases } from "./corpus.ts";
import { expect, test } from "vite-plus/test";
import { failureLines, sweep } from "./sweep.ts";

/** The whole corpus takes about 130 s alone, saga about 40 s of it; a case gets room for a loaded CI runner, where it runs up to five times slower. */
const CASE_TIMEOUT_MS = 240_000;

/** What each case sweeps today, at least: a sweep that loses stands (focus, walks) or clicks fails. Raise a floor when the viewer offers more; lower it when a fix makes a dead element plain. */
const FLOORS: Record<string, { stands: number; clicks: number }> = {
  checkout: { stands: 170, clicks: 355 },
  auth: { stands: 268, clicks: 593 },
  saga: { stands: 554, clicks: 1155 },
  credit: { stands: 120, clicks: 232 },
  retry: { stands: 47, clicks: 106 },
  parts: { stands: 74, clicks: 162 },
  teamInbox: { stands: 141, clicks: 284 },
  uploadRegions: { stands: 36, clicks: 81 },
  sharedGo: { stands: 44, clicks: 88 },
  grouped: { stands: 118, clicks: 264 },
  timed: { stands: 21, clicks: 41 },
  lockedDoor: { stands: 24, clicks: 42 },
  photoQueue: { stands: 32, clicks: 82 },
  order: { stands: 725, clicks: 1774 },
};

for (const sweepCase of [...exampleCases(), ...fixtureCases()]) {
  test(
    `every element of ${sweepCase.name} that looks clickable changes the view`,
    async () => {
      const report = await sweep(sweepCase);
      const floor = FLOORS[sweepCase.name];
      const covered = {
        stands: Math.min(report.stands, floor.stands),
        clicks: Math.min(report.clicks, floor.clicks),
      };
      expect({ failures: failureLines(report), covered }).toEqual({
        failures: [],
        covered: floor ?? "a floor in FLOORS",
      });
    },
    CASE_TIMEOUT_MS,
  );
}
