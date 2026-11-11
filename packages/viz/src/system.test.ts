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
      { id: "", kind: "root", label: "photoUpload" },
      { id: "upload", kind: "region", label: "upload" },
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

  test("a map output links to the root and to a region that takes it", () => {
    const machine: VizMachine = {
      ...base,
      regions: ["log", "workers"],
      maps: ["workers"],
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
