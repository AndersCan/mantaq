import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vite-plus/test";
import { decodeLiveSteps } from "../../viz/src/moves.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..");
const SCRATCH = mkdtempSync(join(PACKAGE, ".record-board-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const PREFIX = "on the board: ";

function boardLines(
  name: string,
  body: string,
  fixture: { path: string; factory: string },
): { lines: string[]; written: boolean } {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "a.test.ts"),
    `import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vitest";
import { recordRuns } from ${JSON.stringify(join(HERE, "record.ts"))};
import { ${fixture.factory} } from ${JSON.stringify(fixture.path)};
const make = recordRuns(${fixture.factory});
${body}`,
  );
  const result = spawnSync(
    join(PACKAGE, "node_modules/.bin/vp"),
    ["test", "run", "--root", dir, "--silent=false"],
    {
      cwd: PACKAGE,
      env: { ...process.env, CI: "", FORCE_COLOR: "0", NO_COLOR: "1" },
      encoding: "utf8",
    },
  );
  const lines = `${result.stdout}${result.stderr}`
    .split("\n")
    .filter((line) => line.startsWith(PREFIX));
  return { lines, written: existsSync(join(dir, "__runs__", "a.test.json")) };
}

function stepsOf(line: string) {
  const query = new URLSearchParams(line.slice(PREFIX.length + 1));
  return decodeLiveSteps(query.getAll("step"));
}

const KITCHEN = {
  path: join(HERE, "../../../apps/docs/src/design/dropped-message.ts"),
  factory: "cookMachine",
};

test("a walk that ends in the wrong state prints its steps as the board replays them, and writes nothing", () => {
  const { lines, written } = boardLines(
    "wrong-state",
    `test("late", () => {
  const made = make.create();
  made.actor.send({ type: "DISH_COOKED" } as never);
  made.waiter.send({ type: "DISH_SERVED" } as never);
  expect(made.waiter.state.name).toBe("onBreak");
});`,
    KITCHEN,
  );
  expect(lines).toEqual([
    "on the board: ?machine=cook&step=DISH_COOKED%3D%7B%7D&step=waiter%3EDISH_SERVED%3D%7B%7D",
  ]);
  // DISH_READY is sent by the kitchen itself, so it is not a step.
  expect(stepsOf(lines[0]!)).toEqual([
    { kind: "event", event: "DISH_COOKED", payload: {} },
    { kind: "event", event: "DISH_SERVED", payload: {}, actor: { region: "waiter" } },
  ]);
  expect(written).toBe(false);
});

test("a send whose handler threw is the last step", () => {
  const { lines } = boardLines(
    "threw",
    `test("throws", () => {
  const actor = make.create();
  actor.send({ type: "pick", payload: { side: "b" } });
  expect(actor.state.name).toBe("picked");
});`,
    { path: join(HERE, "fixtures/throwing.ts"), factory: "throwing" },
  );
  expect(lines).toEqual(["on the board: ?machine=throwing&step=pick%3D%7B%22side%22%3A%22b%22%7D"]);
});

const WALK = { path: join(HERE, "fixtures/board-walk.ts"), factory: "boardWalk" };

test("a payload that is not JSON prints that the board cannot show it, a passing test prints nothing", () => {
  const { lines } = boardLines(
    "not-shown",
    `test("bigint", () => {
  const actor = make.create();
  actor.send({ type: "ping" });
  actor.send({ type: "loop", payload: { n: 10n } } as never);
  expect(1).toBe(2);
});
test("fine", () => {
  make.create().send({ type: "ping" });
});`,
    WALK,
  );
  expect(lines).toEqual(["on the board: not shown"]);
});

test("a send whose effect threw is the last step", () => {
  const { lines } = boardLines(
    "effect",
    `test("effect", () => {
  const actor = make.create();
  actor.send({ type: "ping" });
  actor.send({ type: "boom" });
  expect(actor.state.name).toBe("hot");
});`,
    WALK,
  );
  expect(lines).toEqual(["on the board: ?machine=boardWalk&step=ping%3D%7B%7D&step=boom%3D%7B%7D"]);
});

test("a send to another machine that threw keeps its region", () => {
  const { lines } = boardLines(
    "pair",
    `test("pair", () => {
  const made = make.create();
  made.actor.send({ type: "ping" });
  made.helper.send({ type: "poke" } as never);
  expect(made.helper.state.name).toBe("loud");
});`,
    { path: join(HERE, "fixtures/board-walk.ts"), factory: "boardPair" },
  );
  expect(lines).toEqual([
    "on the board: ?machine=boardPair&step=ping%3D%7B%7D&step=helper%3Epoke%3D%7B%7D",
  ]);
});

test("a clock advance is a step, before or after an event", () => {
  const TIMED = { path: join(HERE, "fixtures/timed.ts"), factory: "timed" };
  const before = boardLines(
    "advance",
    `test("early", () => {
  const clock = VirtualClock();
  const actor = make.create({ clock });
  clock.advance(100);
  actor.send({ type: "start" });
  expect(actor.state.name).toBe("idle");
});`,
    TIMED,
  );
  expect(before.lines).toEqual(["on the board: ?machine=timed&step=%40100&step=start%3D%7B%7D"]);
  const after = boardLines(
    "late",
    `test("late", () => {
  const clock = VirtualClock();
  const actor = make.create({ clock });
  actor.send({ type: "start" });
  clock.advance(800);
  expect(actor.state.name).toBe("waiting");
});`,
    TIMED,
  );
  expect(after.lines).toEqual(["on the board: ?machine=timed&step=start%3D%7B%7D&step=%40800"]);
});

test("a walk the board cannot replay on the factory's defaults is not shown", () => {
  const ends = boardLines(
    "ends-elsewhere",
    `test("locked", () => {
  const actor = make.create({ clock: VirtualClock(), locked: true });
  actor.send({ type: "pushDoor" });
  expect(actor.state.name).toBe("openedDoor");
});`,
    { path: join(HERE, "fixtures/locked-door.ts"), factory: "lockedDoor" },
  );
  expect(ends.lines).toEqual(["on the board: not shown"]);
  const throws = boardLines(
    "factory-throws",
    `test("opens", () => {
  const actor = make.create({ need: "fuel" });
  actor.send({ type: "ping" });
  expect(actor.state.name).toBe("idle");
});`,
    { path: join(HERE, "fixtures/board-walk.ts"), factory: "boardNeeds" },
  );
  expect(throws.lines).toEqual(["on the board: not shown"]);
});

test("a throw keeps its place among the steps that came after it", () => {
  const { lines } = boardLines(
    "relay",
    `test("served first", () => {
  const made = make.create();
  made.waiter.send({ type: "served" } as never);
  made.actor.send({ type: "cooked" } as never);
  expect(made.waiter.state.name).toBe("carrying");
});`,
    { path: join(HERE, "fixtures/board-walk.ts"), factory: "boardRelay" },
  );
  // Swapped, the board hands the waiter a dish first and the throw never happens.
  expect(lines).toEqual([
    "on the board: ?machine=boardRelay&step=waiter%3Eserved%3D%7B%7D&step=cooked%3D%7B%7D",
  ]);
});
