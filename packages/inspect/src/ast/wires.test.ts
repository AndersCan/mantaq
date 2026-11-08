import { createReceiverActor } from "../fixtures/wired/receiver.ts";
import { createSenderActor } from "../fixtures/wired/sender.ts";
import { inspectModule } from "../inspect.ts";
import { findWires } from "./wires.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";

const DIR = join(import.meta.dirname, "..", "fixtures", "wired");
const ROOT = join(import.meta.dirname, "..", "fixtures");
const files = ["sender.ts", "receiver.ts"].map((name) => join(DIR, name));

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
