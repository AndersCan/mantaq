import { describe, expect, test } from "vite-plus/test";
import { VIZ_SCHEMA_VERSION } from "./schema.ts";
import type { VizDocument, VizEdge, VizMachine, VizState } from "./schema.ts";
import { linksInside, systemOf } from "./system.ts";
import { parseViz, validateViz } from "./validate.ts";
import { serializeViz } from "./serialize.ts";

const state = (id: string): VizState => ({
  id,
  label: id,
  region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
  initial: false,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const edge = (from: string, event: string, emits: string[] = []): VizEdge => ({
  id: `${from}-${event}`,
  from,
  event,
  to: from,
  kind: "stay",
  origin: "declared",
  emits,
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
});

const base: VizMachine = {
  id: "screen",
  initial: null,
  regions: [],
  maps: [],
  actors: [],
  states: [],
  events: [],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [],
  fuzz: null,
  runs: [],
};

const upload: VizMachine = {
  ...base,
  id: "photoUpload",
  regions: ["upload"],
  states: [state("showing"), state("upload.waiting"), state("upload.sending")],
  partOutputs: { upload: ["photoUploaded"] },
  edges: [
    edge("upload.sending", "uploadConfirmed", ["photoUploaded"]),
    edge("showing", "photoUploaded"),
  ],
};

describe("systemOf", () => {
  test("a region output links to its parent, with the states that take it", () => {
    const system = systemOf(upload);
    expect(system.parts).toEqual([
      { id: "", kind: "root", label: "photoUpload", within: "upload", alone: false },
      { id: "upload", kind: "region", label: "upload", within: null, alone: false },
    ]);
    expect(system.links).toEqual([
      {
        from: "upload",
        to: "",
        event: "photoUploaded",
        handledIn: ["showing"],
        senders: ["upload.sending-uploadConfirmed"],
      },
    ]);
    expect(linksInside(system)).toBe(true);
  });

  test("a region output goes only to its parent, not to a sibling that takes it", () => {
    const machine: VizMachine = {
      ...upload,
      regions: ["network", "upload"],
      states: [...upload.states, state("network.online")],
      edges: [...upload.edges.slice(0, 1), edge("network.online", "photoUploaded")],
    };
    expect(systemOf(machine).links).toMatchObject([{ from: "upload", to: null, handledIn: [] }]);
  });

  test("a part only counts the handlers in its own states", () => {
    const machine: VizMachine = {
      ...upload,
      edges: [
        edge("upload.sending", "uploadConfirmed", ["photoUploaded"]),
        edge("upload.waiting", "photoUploaded"),
      ],
    };
    expect(systemOf(machine).links).toMatchObject([{ from: "upload", to: null }]);
  });

  test("a nested region's output goes to the region around it, or the root when that is no part", () => {
    const nested: VizMachine = {
      ...base,
      regions: ["a", "a.b"],
      states: [state("top"), state("a.x"), state("a.b.y")],
      partOutputs: { "a.b": ["ping"] },
      edges: [edge("a.x", "ping"), edge("top", "ping")],
    };
    expect(systemOf(nested).links).toMatchObject([{ from: "a.b", to: "a", handledIn: ["a.x"] }]);
    const orphaned: VizMachine = {
      ...nested,
      regions: ["a.b"],
      states: [state("top"), state("a.b.y")],
    };
    expect(systemOf(orphaned).links).toMatchObject([{ from: "a.b", to: "", handledIn: ["top"] }]);
  });

  test("a root output nobody takes leaves the machine", () => {
    const machine: VizMachine = { ...base, outputs: ["done"], states: [state("a")] };
    const system = systemOf(machine);
    expect(system.links).toEqual([
      { from: "", to: null, event: "done", handledIn: [], senders: [] },
    ]);
    expect(linksInside(system)).toBe(false);
  });

  test("a root output the root itself handles leaves the machine", () => {
    const machine: VizMachine = {
      ...base,
      outputs: ["done"],
      states: [state("a")],
      edges: [edge("a", "done")],
    };
    expect(systemOf(machine).links).toMatchObject([{ to: null, handledIn: [] }]);
  });

  test("senders list only the edges in the sending part", () => {
    const machine: VizMachine = {
      ...upload,
      edges: [...upload.edges, edge("showing", "other", ["photoUploaded"])],
    };
    expect(systemOf(machine).links[0]?.senders).toEqual(["upload.sending-uploadConfirmed"]);
  });

  test("an actor part sends to any part that takes the event, a region only to its parent", () => {
    const machine: VizMachine = {
      ...base,
      regions: ["inbox", "workers"],
      maps: ["workers"],
      actors: ["inbox"],
      states: [state("open"), state("inbox.idle"), state("workers.free")],
      partOutputs: { inbox: ["assign"] },
      edges: [edge("workers.free", "assign")],
    };
    const system = systemOf(machine);
    expect(system.parts.map((part) => [part.id, part.kind])).toEqual([
      ["", "root"],
      ["inbox", "actor"],
      ["workers", "map"],
    ]);
    expect(system.links).toMatchObject([{ from: "inbox", to: "workers", event: "assign" }]);
    expect(systemOf({ ...machine, actors: [] }).links).toMatchObject([{ from: "inbox", to: null }]);
  });

  test("a map output links to the root and to a region that takes it", () => {
    const machine: VizMachine = {
      ...base,
      regions: ["log", "workers"],
      maps: ["workers"],
      actors: [],
      states: [state("open"), state("log.on"), state("workers.free"), state("workers.working")],
      partOutputs: { workers: ["finished"] },
      edges: [edge("open", "finished"), edge("log.on", "finished")],
    };
    expect(systemOf(machine).links.map((link) => [link.from, link.to])).toEqual([
      ["workers", ""],
      ["workers", "log"],
    ]);
  });

  test("an any-state handler covers every state of its part", () => {
    const machine: VizMachine = {
      ...base,
      outputs: ["go"],
      regions: ["log", "workers"],
      maps: ["workers"],
      actors: [],
      states: [state("open"), state("log.on"), state("workers.free"), state("workers.working")],
      edges: [edge("workers.*", "go")],
    };
    expect(systemOf(machine).links).toMatchObject([
      { from: "", to: "workers", handledIn: ["workers.free", "workers.working"] },
    ]);
  });

  test("an effect edge does not count as taking the event", () => {
    const machine: VizMachine = {
      ...base,
      outputs: ["go"],
      regions: ["r"],
      states: [state("a"), state("r.b")],
      edges: [{ ...edge("r.b", "go"), kind: "effect" }],
    };
    expect(systemOf(machine).links).toMatchObject([{ to: null }]);
  });
});

describe("entries", () => {
  const pool: VizMachine = {
    ...base,
    regions: ["workers"],
    maps: ["workers"],
    actors: [],
    states: [state("empty"), state("workers.free")],
    events: [
      { id: "ARRIVED", internal: false, doc: null, payload: null },
      { id: "BACK", internal: false, doc: null, payload: null },
      { id: "RUN_DONE", internal: true, doc: null, payload: null },
    ],
    partOutputs: { workers: ["BACK"] },
    edges: [
      edge("empty", "ARRIVED"),
      edge("empty", "BACK"),
      edge("empty", "RUN_DONE"),
      edge("workers.free", "ARRIVED"),
      edge("workers.free", "BACK", ["BACK"]),
    ],
  };

  test("an event the root handles that no link brings is an entry", () => {
    expect(systemOf(pool).entries).toEqual([{ to: "", event: "ARRIVED" }]);
  });

  test("an event brought by a link, an internal event and a map's events are not entries", () => {
    const events = systemOf(pool).entries.map((entry) => entry.event);
    expect(events).not.toContain("BACK");
    expect(events).not.toContain("RUN_DONE");
    expect(systemOf(pool).entries.some((entry) => entry.to === "workers")).toBe(false);
  });

  test("entries are sorted and listed once per event", () => {
    const machine: VizMachine = {
      ...pool,
      edges: [edge("empty", "ZED"), edge("empty", "ARRIVED"), edge("other", "ARRIVED")],
    };
    expect(systemOf(machine).entries).toEqual([
      { to: "", event: "ARRIVED" },
      { to: "", event: "ZED" },
    ]);
  });

  test("a region has entries of its own", () => {
    const machine: VizMachine = {
      ...upload,
      edges: [...upload.edges, edge("upload.waiting", "pick")],
    };
    expect(systemOf(machine).entries).toContainEqual({ to: "upload", event: "pick" });
  });
});

describe("partOutputs in the document", () => {
  const doc: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines: [upload] };

  test("round-trips", () => {
    expect(parseViz(serializeViz(doc))[1]).toEqual(doc);
  });

  test("a missing or malformed field is reported", () => {
    const { partOutputs: _gone, ...without } = upload;
    expect(validateViz({ ...doc, machines: [without] })[0]).toEqual([
      { path: "$.machines[0].partOutputs", message: "expected object" },
    ]);
    for (const wrong of [[], "x", null]) {
      expect(validateViz({ ...doc, machines: [{ ...upload, partOutputs: wrong }] })[0]).toEqual([
        { path: "$.machines[0].partOutputs", message: "expected object" },
      ]);
    }
    const bad = { ...upload, partOutputs: { upload: "photoUploaded" } };
    expect(validateViz({ ...doc, machines: [bad] })[0]).toEqual([
      { path: "$.machines[0].partOutputs.upload", message: "expected string[]" },
    ]);
  });
});

describe("arrange: within and alone", () => {
  const partOf = (machine: VizMachine, id: string) =>
    systemOf(machine).parts.find((part) => part.id === id);

  test("a small part sits within the bigger part it talks to", () => {
    const machine: VizMachine = {
      ...upload,
      states: [
        state("showing"),
        state("b"),
        state("c"),
        state("upload.waiting"),
        state("upload.sending"),
      ],
    };
    expect(partOf(machine, "upload")).toMatchObject({ within: "", alone: false });
    expect(partOf(machine, "")).toMatchObject({ within: null, alone: false });
  });

  test("equal state counts sit within nothing", () => {
    const machine: VizMachine = {
      ...upload,
      states: [state("showing"), state("b"), state("upload.waiting"), state("upload.sending")],
    };
    expect(partOf(machine, "upload")).toMatchObject({ within: null });
    expect(partOf(machine, "")).toMatchObject({ within: null });
  });

  test("a part with only a grey end is alone", () => {
    const machine: VizMachine = {
      ...upload,
      regions: ["upload", "net"],
      states: [...upload.states, state("net.up")],
      partOutputs: { upload: ["photoUploaded"], net: ["nobodyTakesThis"] },
    };
    expect(partOf(machine, "net")).toMatchObject({ alone: true, within: null });
    expect(partOf(machine, "upload")?.alone).toBe(false);
  });

  test("a part joined to two parts sits within neither", () => {
    const machine: VizMachine = {
      ...base,
      id: "chain",
      regions: ["a", "c"],
      states: [state("b1"), state("b2"), state("b3"), state("a.x"), state("c.x"), state("c.y")],
      partOutputs: { a: ["fromA"], c: ["fromC"] },
      edges: [edge("b1", "fromA"), edge("b1", "fromC")],
    };
    expect(partOf(machine, "a")).toMatchObject({ within: "" });
    expect(partOf(machine, "c")).toMatchObject({ within: "" });
    expect(partOf(machine, "")).toMatchObject({ within: null, alone: false });
  });

  test("no part sits within a part that sits within another", () => {
    const machines: VizMachine[] = [
      upload,
      {
        ...base,
        regions: ["a", "c"],
        states: [state("b1"), state("b2"), state("b3"), state("a.x"), state("c.x"), state("c.y")],
        partOutputs: { a: ["fromA"], c: ["fromC"] },
        edges: [edge("b1", "fromA"), edge("b1", "fromC")],
      },
      {
        ...base,
        regions: ["a", "c"],
        states: [state("b1"), state("a.x"), state("a.y"), state("a.z"), state("c.x")],
        partOutputs: { a: ["fromA"], c: ["fromC"] },
        edges: [edge("b1", "fromA"), edge("a.x", "fromC")],
      },
    ];
    for (const machine of machines) {
      const { parts } = systemOf(machine);
      for (const part of parts) {
        const holder = parts.find((other) => other.id === part.within);
        if (holder !== undefined) expect(holder.within).toBeNull();
      }
    }
  });
});
