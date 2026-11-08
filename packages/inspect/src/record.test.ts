import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "./examples.ts";
import { inspectModule } from "./inspect.ts";
import { normalizeRun } from "./runs.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { VirtualClock } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { createCheckoutActor } from "../../../apps/docs/src/content/docs/checkout.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..");
const SCRATCH = mkdtempSync(join(PACKAGE, ".record-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function testFile(
  dir: string,
  body: string,
  { fixture, factory } = { fixture: join(HERE, "fixtures/timed.ts"), factory: "createTimedActor" },
): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "a.test.ts"),
    `import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vitest";
import { recordRuns } from ${JSON.stringify(join(HERE, "record.ts"))};
import { ${factory} } from ${JSON.stringify(fixture)};
const make = recordRuns(${factory});
${body}`,
  );
  return join(dir, "__runs__", "a.test.json");
}

function run(dir: string, env: Record<string, string>): { ok: boolean; output: string } {
  const result = spawnSync(
    join(PACKAGE, "node_modules/.bin/vp"),
    ["test", "run", "--root", dir, "--silent=false"],
    {
      cwd: PACKAGE,
      env: { ...process.env, CI: "", ...env },
      encoding: "utf8",
    },
  );
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

const PASSING = `
test("one", () => {
  const clock = VirtualClock();
  const actor = make(clock);
  actor.send({ type: "start" });
  clock.advance(800);
  expect(actor.state.name).toBe("error");
});
test("fails", () => {
  const actor = make();
  actor.send({ type: "start" });
  expect(actor.state.name).toBe("idle");
});
test("two actors", () => {
  make();
  make().send({ type: "start" });
});
`;

describe("recordRuns", () => {
  test("the fixture records itself into its committed file", () => {
    const committed = readFileSync(join(HERE, "fixtures/__runs__/timed.test.json"), "utf8");
    const result = run(join(HERE, "fixtures"), { CI: "1" });
    expect(result.ok).toBe(true);
    expect(committed).toContain('"times out"');
  });

  test("passing tests are recorded, a failed one is not, a second actor is numbered", () => {
    const dir = join(SCRATCH, "record");
    const file = testFile(dir, PASSING);
    run(dir, {});
    const recorded = JSON.parse(readFileSync(file, "utf8")) as {
      timed: { name: string; end: string }[];
    };
    expect(recorded.timed.map((each) => [each.name, each.end])).toEqual([
      ["one", "error"],
      ["two actors", "idle"],
      ["two actors #2", "waiting"],
    ]);
  });

  test("with CI set a tampered file fails with a clear message", () => {
    const dir = join(SCRATCH, "tamper");
    const file = testFile(dir, PASSING);
    run(dir, {});
    writeFileSync(file, readFileSync(file, "utf8").replace('"one"', '"uno"'));
    const result = run(dir, { CI: "1" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("is out of date");
  });

  test("a non-JSON payload is not recorded and warns", () => {
    const dir = join(SCRATCH, "payload");
    const file = testFile(
      dir,
      `test("loop", () => {
  const actor = make();
  actor.send({ type: "start", payload: 10n } as never);
});`,
    );
    const result = run(dir, {});
    expect(result.output).toContain('"loop" not recorded, payload is not JSON');
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  test("a factory called in beforeEach is recorded under the test's name", () => {
    const dir = join(SCRATCH, "hook");
    const file = testFile(
      dir,
      `import { beforeEach } from "vitest";
let actor: ReturnType<typeof make>;
beforeEach(() => { actor = make(); });
test("hooked", () => { actor.send({ type: "start" }); });`,
    );
    const result = run(dir, {});
    expect(result.ok).toBe(true);
    const recorded = JSON.parse(readFileSync(file, "utf8")) as { timed: { name: string }[] };
    expect(recorded.timed.map((each) => each.name)).toEqual(["hooked"]);
  });

  test("a retried test is recorded once under its plain name", () => {
    const dir = join(SCRATCH, "retry");
    const file = testFile(
      dir,
      `let tries = 0;
test("flaky", { retry: 2 }, () => {
  make().send({ type: "start" });
  tries += 1;
  expect(tries).toBe(2);
});`,
    );
    run(dir, {});
    const recorded = JSON.parse(readFileSync(file, "utf8")) as { timed: { name: string }[] };
    expect(recorded.timed.map((each) => each.name)).toEqual(["flaky"]);
  });

  test("a Map payload is not recorded and warns, an empty object is kept", () => {
    const dir = join(SCRATCH, "lossy");
    const file = testFile(
      dir,
      `test("map", () => { make().send({ type: "start", payload: new Map() } as never); });
test("empty", () => { make().send({ type: "start", payload: {} } as never); });`,
    );
    const result = run(dir, {});
    expect(result.output).toContain('"map" not recorded, payload is not JSON');
    const recorded = JSON.parse(readFileSync(file, "utf8")) as {
      timed: { name: string; steps: { payload: unknown }[] }[];
    };
    expect(recorded.timed.map((each) => each.name)).toEqual(["empty"]);
    expect(recorded.timed[0]?.steps[0]?.payload).toEqual({});
  });

  test("an injected effect answer is recorded and replays to the same end", () => {
    const dir = join(SCRATCH, "answer");
    const file = testFile(
      dir,
      `test("card declined", async () => {
  const { actor } = make({ clock: VirtualClock() });
  actor.send({ type: "submitBasicInfo", payload: { email: "a@b.c", name: "Ann" } });
  actor.send({ type: "submitShipping", payload: { street: "1 Main", city: "Oslo", zip: "0150" } });
  actor.send({ type: "submitPayment", payload: { cardNumber: "4242" } });
  actor.inject({ type: "paymentFail", payload: { reason: "Card declined" } });
  await actor.settled();
  expect(actor.state.name).toBe("error");
});`,
      {
        fixture: join(EXAMPLE_ROOT, "apps/docs/src/content/docs/checkout.ts"),
        factory: "createCheckoutActor",
      },
    );
    const ran = run(dir, {});
    expect(ran.ok).toBe(true);
    const recorded = JSON.parse(readFileSync(file, "utf8")) as {
      checkout: Parameters<typeof normalizeRun>[1][];
    };
    const walk = recorded.checkout.find((each) => each.name === "card declined");
    if (walk === undefined) throw new Error("card declined not recorded");
    expect(walk.end).toBe("error");
    expect(walk.steps).toHaveLength(4);
    expect(walk.steps.at(-1)).toEqual({
      kind: "event",
      event: "paymentFail",
      payload: { reason: "Card declined" },
    });
    expect(walk.steps.some((step) => step.kind === "event" && step.event === "paymentOk")).toBe(
      false,
    );
    const target: FuzzTarget = {
      id: "checkout",
      create: () => {
        const clock = VirtualClock();
        return { actor: createCheckoutActor({ clock }).actor, clock };
      },
    };
    expect(normalizeRun(target, walk)).toEqual(Either.right(walk.steps));
  });

  test("inspect shows the recorded runs on the fixture", async () => {
    const { machines } = await inspectModule(
      join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/timed.ts"),
      { load: (path) => import(path), fuzz: { iterations: 0 } },
    );
    expect(machines[0]?.runs.map((each) => each.name)).toEqual(["times out", "waits"]);
  });
});

describe("recordRuns replays a test that passes options", () => {
  const door = {
    fixture: join(HERE, "fixtures/locked-door.ts"),
    factory: "createLockedDoorActor",
  };
  const unlocked = `test("unlocked", () => { const actor = make({ clock: VirtualClock() }); actor.send({ type: "pushDoor" }); expect(actor.state.name).toBe("openedDoor"); });`;

  test("ends elsewhere on the defaults: the test fails and the run is not recorded", () => {
    const dir = join(SCRATCH, "replay-differs");
    const file = testFile(
      dir,
      `test("locked", () => { const actor = make({ clock: VirtualClock(), locked: true }); actor.send({ type: "pushDoor" }); expect(actor.state.name).toBe("lockedOut"); });
${unlocked}`,
      door,
    );
    const result = run(dir, {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain(
      'recordRuns: run "locked" dropped: replays to openedDoor, the test ended in lockedOut.',
    );
    expect(result.output).toContain("This test passed: locked.");
    const recorded = JSON.parse(readFileSync(file, "utf8")) as {
      lockedDoor: { name: string }[];
    };
    expect(recorded.lockedDoor.map((each) => each.name)).toEqual(["unlocked"]);
  });

  test("same end on the defaults: recorded as today", () => {
    const dir = join(SCRATCH, "replay-same");
    const file = testFile(
      dir,
      `test("open", () => { const actor = make({ clock: VirtualClock(), locked: false }); actor.send({ type: "pushDoor" }); expect(actor.state.name).toBe("openedDoor"); });`,
      door,
    );
    expect(run(dir, {}).ok).toBe(true);
    expect(readFileSync(file, "utf8")).toContain('"open"');
  });
});
