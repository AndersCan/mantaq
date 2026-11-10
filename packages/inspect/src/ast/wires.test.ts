import { createReceiverActor } from "../fixtures/wired/receiver.ts";
import { createSenderActor } from "../fixtures/wired/sender.ts";
import { inspectModule } from "../inspect.ts";
import { createDuoActor } from "../fixtures/wired-unheard/duo.ts";
import { createQuietActor } from "../fixtures/wired/quiet.ts";
import { createSketchActor } from "../fixtures/wired/sketch.ts";
import { findWires, scanAppCode } from "./wires.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";

const DIR = join(import.meta.dirname, "..", "fixtures", "wired");
const ROOT = join(import.meta.dirname, "..", "fixtures");
const files = ["sender.ts", "receiver.ts"].map((name) => join(DIR, name));
const sketch = join(DIR, "sketch.ts");
const quiet = join(DIR, "quiet.ts");

async function machines() {
  const sender = await inspectModule(files[0] ?? "", {
    load: async () => ({ createSenderActor }),
    fuzz: false,
  });
  const receiver = await inspectModule(files[1] ?? "", {
    load: async () => ({ createReceiverActor }),
    fuzz: false,
  });
  return [...sender.machines, ...receiver.machines];
}

function lineOf(text: string): number {
  const lines = readLines();
  return lines.findIndex((line) => line.includes(text)) + 1;
}

function readLines(): string[] {
  return ts.sys.readFile(join(DIR, "wire.ts"))?.split("\n") ?? [];
}

describe("scanAppCode", () => {
  test("lists the machine only a test and a type use mention, and keeps the wires", async () => {
    const sketched = await inspectModule(sketch, {
      load: async () => ({ createSketchActor }),
      fuzz: false,
    });
    const all = [...(await machines()), ...sketched.machines];
    const scanned = scanAppCode({ root: ROOT, files: [...files, sketch], machines: all });
    expect(scanned.notRun).toEqual([
      { id: "sketch", factory: "createSketchActor", file: "wired/sketch.ts" },
    ]);
    expect(scanned.wires).toEqual(findWires({ root: ROOT, files, machines: all }));
    expect(scanned.wires).toHaveLength(3);
  });

  test("lists the output no listener hears, hearing every output of an unguarded listener", async () => {
    const sketched = await inspectModule(sketch, {
      load: async () => ({ createSketchActor }),
      fuzz: false,
    });
    const quieted = await inspectModule(quiet, {
      load: async () => ({ createQuietActor }),
      fuzz: false,
    });
    const all = [...(await machines()), ...sketched.machines, ...quieted.machines];
    const scanned = scanAppCode({ root: ROOT, files: [...files, sketch, quiet], machines: all });
    expect(scanned.unheard).toEqual([{ id: "quiet", outputs: ["unheard"] }]);
    expect(scanned.notRun).toEqual([
      { id: "sketch", factory: "createSketchActor", file: "wired/sketch.ts" },
    ]);
    expect(scanned.wires).toHaveLength(3);
  });

  test("a machine exported only as an instance is never listed", async () => {
    const edges = join(ROOT, "wired-edges", "edges.ts");
    const scanned = scanAppCode({ root: ROOT, files: [edges], machines: await machines() });
    expect(scanned.notRun).toEqual([]);
  });

  test("a factory passed as a value counts as run", async () => {
    const dir = mkdtempSync(join(ROOT, "wired", "tmp-"));
    try {
      writeFileSync(
        join(dir, "use.ts"),
        'import { createSketchActor as make } from "../sketch.ts";\nexport const list = [1].map(() => make());\n',
      );
      writeFileSync(join(dir, "tsconfig.json"), '{"extends":"../tsconfig.json","include":["."]}');
      const sketched = await inspectModule(sketch, {
        load: async () => ({ createSketchActor }),
        fuzz: false,
      });
      const scanned = scanAppCode({
        root: ROOT,
        files: [sketch, join(dir, "use.ts")],
        machines: sketched.machines,
      });
      expect(scanned.notRun).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanAppCode unheard outputs", () => {
  const UNHEARD = join(ROOT, "wired-unheard");
  const duo = join(UNHEARD, "duo.ts");
  const header =
    'import { createDuoActor } from "../duo.ts";\nconst actor = createDuoActor();\nfunction note(): void {}\n';

  async function unheardWith(listeners: string | null) {
    const dir = mkdtempSync(join(UNHEARD, "tmp-"));
    try {
      writeFileSync(join(dir, "tsconfig.json"), '{"extends":"../tsconfig.json","include":["."]}');
      if (listeners !== null) writeFileSync(join(dir, "use.ts"), header + listeners);
      const duoed = await inspectModule(duo, {
        load: async () => ({ createDuoActor }),
        fuzz: false,
      });
      const used = listeners === null ? [] : [join(dir, "use.ts")];
      return scanAppCode({ root: ROOT, files: [duo, ...used], machines: duoed.machines });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a machine no app code runs gets a not-run entry and no unheard entry", async () => {
    const scanned = await unheardWith(null);
    expect(scanned.notRun.map((each) => each.id)).toEqual(["duo"]);
    expect(scanned.unheard).toEqual([]);
  });

  test("a change listener hears no output", async () => {
    const scanned = await unheardWith('actor.on("change", { fn: () => note() });\n');
    expect(scanned.unheard).toEqual([{ id: "duo", outputs: ["a", "b"] }]);
  });

  test("outputs named in two listeners are both heard", async () => {
    const scanned = await unheardWith(
      'actor.on("output", { fn: (e) => { if (e.type === "a") note(); } });\n' +
        'actor.on("output", { fn: (e) => { if (e.type === "b") note(); } });\n',
    );
    expect(scanned.unheard).toEqual([]);
  });

  test("one listener naming one output leaves the other unheard", async () => {
    const scanned = await unheardWith(
      'actor.on("output", { fn: (e) => { if (e.type === "a") note(); } });\n',
    );
    expect(scanned.unheard).toEqual([{ id: "duo", outputs: ["b"] }]);
  });

  test("a comparison on a value that is not .type names no output", async () => {
    const scanned = await unheardWith(
      'actor.on("output", { fn: (e) => { const kind: string = e.type; if (kind === "a") note(); } });\n',
    );
    expect(scanned.unheard).toEqual([]);
  });

  test("a listener that checks no output by name hears all of them", async () => {
    const scanned = await unheardWith('actor.on("output", { fn: () => note() });\n');
    expect(scanned.unheard).toEqual([]);
  });

  test("an early-return type guard hears only the output it lets through", async () => {
    const scanned = await unheardWith(
      'actor.on("output", { fn: (e) => { if (e.type !== "a") return; note(); } });\n',
    );
    expect(scanned.unheard).toEqual([{ id: "duo", outputs: ["b"] }]);
  });

  test.each([
    ["a throw guard", 'if (e.type !== "a") throw new Error("no"); note();', ["b"]],
    ["a guard with an else", 'if (e.type !== "a") return; else note();', []],
    ["a guard with an empty block", 'if (e.type !== "a") {} note();', []],
    ["a guard on a literal that is no output", 'if (e.type !== "zzz") return; note();', []],
    [
      "a guard nested under another condition",
      'if (e.ok) { if (e.type !== "a") return; } note();',
      [],
    ],
    ["a guard whose return carries a value", 'if (e.type !== "a") return forward(e); note();', []],
    [
      "an equality guard is a plain check, not an early return",
      'if (e.type === "a") return; note();',
      ["b"],
    ],
    ["a guard on another property", 'if (e.kind !== "a") return; note();', []],
    ["a guard against an event's type", "if (e.type !== known.type) return; note();", ["b"]],
    ["a guard in a block that returns", 'if (e.type !== "a") { return; } note();', ["b"]],
  ])("early-return: %s", async (_name, body, unheard) => {
    const scanned = await unheardWith(
      `const known = { type: "a" } as const;\nfunction forward(e: unknown): void {}\nactor.on("output", { fn: (e) => { ${body} } });\n`,
    );
    expect(scanned.unheard).toEqual(unheard.map((output) => ({ id: "duo", outputs: [output] })));
  });

  test("a checked if with an else hears every output", async () => {
    const scanned = await unheardWith(
      'actor.on("output", { fn: (e) => { if (e.type === "a") note(); else note(); } });\n',
    );
    expect(scanned.unheard).toEqual([]);
  });
});

describe("findWires", () => {
  test("finds the guarded, two-hop change and typed-parameter connections between two machines", async () => {
    const found = findWires({ root: ROOT, files, machines: await machines() });
    const base = { from: "sender", to: "receiver" };
    expect(found).toEqual(
      [
        {
          ...base,
          trigger: "handedOver",
          event: "take",
          at: `wired/wire.ts:${lineOf("receiver.take();")}`,
        },
        {
          ...base,
          trigger: "change",
          event: "poke",
          at: `wired/wire.ts:${lineOf('senderActor.on("change"')}`,
        },
        {
          ...base,
          trigger: "output",
          event: "take",
          at: `wired/wire.ts:${lineOf("r.send(take.create())")}`,
        },
      ].sort((a, b) => JSON.stringify([a.at]).localeCompare(JSON.stringify([b.at]))),
    );
  });

  test("returns no wires when the receiver is not in the machine list", async () => {
    const only = (await machines()).filter((machine) => machine.id !== "receiver");
    expect(findWires({ root: ROOT, files, machines: only })).toEqual([]);
  });

  test("prefers the machine whose inputs equal the actor's over one that also handles more", async () => {
    const all = await machines();
    const wider = all
      .filter((machine) => machine.id === "receiver")
      .map((machine) => ({
        ...machine,
        id: "wider",
        events: [...machine.events, { id: "extra", internal: false, doc: null, payload: null }],
      }));
    const found = findWires({ root: ROOT, files, machines: [...all, ...wider] });
    expect(found.map((wire) => wire.to)).toEqual(["receiver", "receiver", "receiver"]);
  });

  test("skips sends more than two calls away, mutual recursion, self wires and the else branch", async () => {
    const edges = join(ROOT, "wired-edges", "edges.ts");
    const found = findWires({ root: ROOT, files: [edges], machines: await machines() });
    const text = ts.sys.readFile(edges)?.split("\n") ?? [];
    const at = (needle: string, nth: number) =>
      `wired-edges/edges.ts:${text.flatMap((line, index) => (line.includes(needle) ? [index + 1] : []))[nth]}`;
    const send = "receiverActor.send(take.create());";
    expect(found).toEqual(
      [
        {
          from: "sender",
          to: "receiver",
          trigger: "change",
          event: "take",
          at: at(`senderActor.on("change"`, 0),
        },
        { from: "sender", to: "receiver", trigger: "output", event: "take", at: at(send, 3) },
        {
          from: "sender",
          to: "receiver",
          trigger: "output",
          event: "take",
          at: at("probe()) {", 0),
        },
        { from: "sender", to: "receiver", trigger: "output", event: "take", at: at(send, 4) },
      ].sort((a, b) => a.at.localeCompare(b.at)),
    );
  });

  test("an early-return type guard names the output the listener hears", async () => {
    const dir = mkdtempSync(join(ROOT, "wired-edges", "tmp-"));
    try {
      writeFileSync(join(dir, "tsconfig.json"), '{"extends":"../../../../tsconfig.json"}');
      const file = join(dir, "listen.ts");
      writeFileSync(
        file,
        'import { receiverActor, take } from "../../wired/receiver.ts";\nimport { senderActor } from "../../wired/sender.ts";\nsenderActor.on("output", {\n  fn: (e: { type: string }) => {\n    if (e.type !== "handedOver") return;\n    receiverActor.send(take.create());\n  },\n});\n',
      );
      const found = findWires({ root: ROOT, files: [file], machines: await machines() });
      expect(found.map((wire) => wire.trigger)).toEqual(["handedOver"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const send = "receiverActor.send(take.create());";
  test.each([
    [
      "a guard before a send names the output",
      `if (e.type !== "handedOver") return;\n    ${send}`,
      "handedOver",
    ],
    [
      "a guard after a send does not",
      `${send}\n    if (e.type !== "handedOver") return;`,
      "output",
    ],
    ["a guard on a non-output does not", `if (e.type !== "zzz") return;\n    ${send}`, "output"],
    [
      "a guard with an else does not",
      `if (e.type !== "handedOver") return; else note();\n    ${send}`,
      "output",
    ],
    [
      "a guard with a throwing send does not",
      `if (e.type !== "handedOver") throw ${send}`,
      "output",
    ],
    ["an equality guard does not", `if (e.type === "handedOver") return;\n    ${send}`, "output"],
    [
      "a guard on another property does not",
      `if (e.kind !== "handedOver") return;\n    ${send}`,
      "output",
    ],
    [
      "a guard that contains the send does not",
      `if (e.type !== "handedOver") return void ${send}`,
      "output",
    ],
    [
      "a guard whose return carries a value does not",
      `if (e.type !== "handedOver") return note();\n    ${send}`,
      "output",
    ],
    [
      "a guard in an enclosing block names the output",
      `if (e.ok) {\n    if (e.type !== "handedOver") return;\n    ${send}\n    }`,
      "handedOver",
    ],
    [
      "a guard names a send in a later nested function",
      `if (e.type !== "handedOver") return;\n    const later = () => ${send}\n    later();`,
      "handedOver",
    ],
  ])("early-return trigger: %s", async (_name, body, trigger) => {
    const dir = mkdtempSync(join(ROOT, "wired-edges", "tmp-"));
    try {
      writeFileSync(join(dir, "tsconfig.json"), '{"extends":"../../../../tsconfig.json"}');
      const file = join(dir, "listen.ts");
      writeFileSync(
        file,
        `import { receiverActor, take } from "../../wired/receiver.ts";\nimport { senderActor } from "../../wired/sender.ts";\nconst note = () => {};\nsenderActor.on("output", {\n  fn: (e: { type: string }) => {\n    ${body}\n  },\n});\n`,
      );
      const found = findWires({ root: ROOT, files: [file], machines: await machines() });
      expect([...new Set(found.map((wire) => wire.trigger))]).toEqual([trigger]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores listeners in test files", async () => {
    const dir = mkdtempSync(join(ROOT, "wired-edges", "tmp-"));
    try {
      writeFileSync(join(dir, "tsconfig.json"), '{"extends":"../../../../tsconfig.json"}');
      const file = join(dir, "listen.test.ts");
      writeFileSync(
        file,
        'import { receiverActor, take } from "../../wired/receiver.ts";\nimport { senderActor } from "../../wired/sender.ts";\nsenderActor.on("change", { fn: () => receiverActor.send(take.create()) });\n',
      );
      expect(findWires({ root: ROOT, files: [file], machines: await machines() })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves a receiver whose inputs are a strict superset of the actor's", async () => {
    const wider = (await machines()).map((machine) =>
      machine.id === "receiver"
        ? {
            ...machine,
            id: "wider",
            events: [...machine.events, { id: "extra", internal: false, doc: null, payload: null }],
          }
        : machine,
    );
    const found = findWires({ root: ROOT, files, machines: wider });
    expect(found.map((wire) => wire.to)).toEqual(["wider", "wider", "wider"]);
  });
});
