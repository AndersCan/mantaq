import { toAtlasMachine } from "../atlas.ts";
import { EXAMPLE_ROOT } from "../examples.ts";
import { createCreditActor } from "../fixtures/credit.ts";
import { createSwitchyActor } from "../fixtures/switchy.ts";
import { annotateMachine } from "./annotate.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FIXTURES = join(EXAMPLE_ROOT, "packages/atlas/src/fixtures");

describe("AST never fails the run", () => {
  test("missing source: handler edges become not_analyzed with the reason", () => {
    const machine = annotateMachine(toAtlasMachine({ id: "credit", actor: createCreditActor() }), {
      file: join(FIXTURES, "does-not-exist.ts"),
      root: EXAMPLE_ROOT,
    });
    const handlerEdges = machine.edges.filter((edge) => edge.kind === "transition");
    expect(handlerEdges.length).toBeGreaterThan(0);
    for (const edge of handlerEdges) {
      expect(edge.explanation).toEqual({
        status: "not_analyzed",
        location: null,
        reason: expect.stringMatching(/^source not found: /),
        snippet: null,
      });
    }
  });

  test("returns inside a switch: not analyzed, with snippet, never guessed", () => {
    const machine = annotateMachine(
      toAtlasMachine({ id: "switchy", actor: createSwitchyActor() }),
      {
        file: join(FIXTURES, "switchy.ts"),
        root: EXAMPLE_ROOT,
      },
    );
    const dial = machine.edges.find((edge) => edge.event === "dial");
    expect(dial?.explanation?.status).toBe("not_analyzed");
    if (dial?.explanation?.status !== "not_analyzed") return;
    expect(dial.explanation.reason).toMatch(/unsupported control flow/);
    expect(dial.explanation.snippet).toMatch(/^\(event\) => \{/);
  });

  test("source without a matching registration: not_analyzed names the pair", () => {
    const machine = annotateMachine(toAtlasMachine({ id: "credit", actor: createCreditActor() }), {
      file: join(FIXTURES, "switchy.ts"),
      root: EXAMPLE_ROOT,
    });
    const apply = machine.edges.find((edge) => edge.event === "apply");
    expect(apply?.explanation).toEqual({
      status: "not_analyzed",
      location: null,
      reason:
        "no m.on/m.onAny registration for (idle, apply) found in packages/atlas/src/fixtures/switchy.ts",
      snippet: null,
    });
  });
});
