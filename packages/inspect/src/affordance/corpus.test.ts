// @vitest-environment happy-dom
import { exampleCases, fixtureCases } from "./corpus.ts";
import { expect, test } from "vite-plus/test";
import { failureLines, sweep } from "./sweep.ts";

/** What each case sweeps today, at least: a sweep that loses stands (focus, walks) or clicks fails. Raise a floor when the viewer offers more. */
const FLOORS: Record<string, { stands: number; clicks: number }> = {
  checkout: { stands: 18, clicks: 197 },
  auth: { stands: 28, clicks: 304 },
  saga: { stands: 36, clicks: 592 },
  credit: { stands: 10, clicks: 105 },
  retry: { stands: 10, clicks: 65 },
  parts: { stands: 24, clicks: 112 },
  teamInbox: { stands: 6, clicks: 111 },
  uploadRegions: { stands: 6, clicks: 51 },
  sharedGo: { stands: 8, clicks: 51 },
  grouped: { stands: 8, clicks: 53 },
  timed: { stands: 6, clicks: 26 },
  lockedDoor: { stands: 6, clicks: 24 },
  photoQueue: { stands: 6, clicks: 38 },
};

for (const sweepCase of [...exampleCases(), ...fixtureCases()]) {
  test(`every element of ${sweepCase.name} that looks clickable changes the view`, async () => {
    const report = await sweep(sweepCase);
    const floor = FLOORS[sweepCase.name] ?? { stands: 1, clicks: 1 };
    const covered = {
      stands: Math.min(report.stands, floor.stands),
      clicks: Math.min(report.clicks, floor.clicks),
    };
    expect({ failures: failureLines(report), covered }).toEqual({ failures: [], covered: floor });
  });
}
