// @vitest-environment happy-dom
import { deadLines, sweep } from "./sweep.ts";
import { exampleCases, fixtureCases } from "./corpus.ts";
import { expect, test } from "vite-plus/test";

for (const sweepCase of [...exampleCases(), ...fixtureCases()]) {
  test(`every element of ${sweepCase.name} that looks clickable changes the view`, async () => {
    const report = await sweep(sweepCase);
    const swept = { dead: deadLines(report), clicked: report.clicks > 0 };
    expect(swept).toEqual({ dead: [], clicked: true });
  });
}
