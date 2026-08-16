/**
 * Drift guard (plan §9.4) — every fixture actor runs through buildVizGraph
 * and the resulting id-set + node/edge counts must match BOTH the registry
 * declarations AND the committed browser/fixtures/fingerprints.json.
 *
 * Upstream refactors that change a pinned fixture's graph shape fail here;
 * updating a fixture deliberately means bumping its FIXTURE_VERSION and
 * regenerating the fingerprint.
 */

import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { buildVizGraph } from "../src/core/graph-model.ts";
import { fixtureList } from "../browser/fixtures/index.ts";

interface Fingerprint {
  FIXTURE_VERSION: number;
  nodeIds: string[];
  nodeCount: number;
  edgeCount: number;
}

function loadFingerprints(): Record<string, Fingerprint> {
  const url = new URL("../browser/fixtures/fingerprints.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, Fingerprint>;
}

const fingerprints = loadFingerprints();

describe("fixture drift guard", () => {
  it("fingerprints.json and the registry cover the same fixture set", () => {
    const registryIds = fixtureList.filter((f) => !f.errorAtMount).map((f) => f.id);
    const jsonIds = Object.keys(fingerprints).filter((id) => !id.startsWith("$"));
    expect(registryIds.sort()).toEqual(jsonIds.sort());
  });

  for (const fixture of fixtureList) {
    it(`graph shape: ${fixture.id}`, () => {
      const result = buildVizGraph(fixture.create().actor);

      if (fixture.errorAtMount) {
        expect(result.status).toBe("error");
        return;
      }

      if (result.status === "error") {
        throw new Error(`${fixture.id}: unexpected buildVizGraph error: ${result.message}`);
      }

      const { nodes, edges } = result.graph;
      const ids = nodes.map((n) => n.id).sort();
      expect(ids).toEqual([...fixture.declares.nodeIds].sort());
      expect(nodes.length).toBe(fixture.declares.nodeCount);
      expect(edges.length).toBe(fixture.declares.edgeCount);

      const fp = fingerprints[fixture.id];
      expect(fp, `fingerprints.json missing ${fixture.id}`).toBeDefined();
      expect(fp.FIXTURE_VERSION).toBe(fixture.version);
      expect([...fp.nodeIds].sort()).toEqual([...fixture.declares.nodeIds].sort());
      expect(fp.nodeCount).toBe(fixture.declares.nodeCount);
      expect(fp.edgeCount).toBe(fixture.declares.edgeCount);
    });
  }
});
