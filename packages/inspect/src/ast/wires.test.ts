import { createReceiverActor } from "../fixtures/wired/receiver.ts";
import { createSenderActor } from "../fixtures/wired/sender.ts";
import { inspectModule } from "../inspect.ts";
import { findWires } from "./wires.ts";
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
});
