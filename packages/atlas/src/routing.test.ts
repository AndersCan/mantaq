import { annotateMachine } from "./ast/annotate.ts";
import { toAtlasMachine } from "./atlas.ts";
import { EXAMPLE_ROOT, exampleTargets } from "./examples.ts";
import { createStateRoutingActor } from "./fixtures/state-routing.ts";
import { routingWarnings } from "./routing.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

describe("routingWarnings", () => {
  test("flags an onAny handler that picks its target from actor state", () => {
    const machine = annotateMachine(
      toAtlasMachine({ id: "routing", actor: createStateRoutingActor() }),
      {
        file: join(EXAMPLE_ROOT, "packages/atlas/src/fixtures/state-routing.ts"),
        root: EXAMPLE_ROOT,
      },
    );
    expect(routingWarnings(machine).map((warning) => warning.event)).toEqual(["back"]);
  });

  test("no example machine routes onAny on actor state", () => {
    for (const example of exampleTargets()) {
      const machine = annotateMachine(
        toAtlasMachine({ id: example.id, actor: example.create().actor }),
        { file: example.source, root: EXAMPLE_ROOT },
      );
      expect(routingWarnings(machine)).toEqual([]);
    }
  });

  test("without AST explanations there is nothing to warn about", () => {
    const machine = toAtlasMachine({ id: "routing", actor: createStateRoutingActor() });
    expect(routingWarnings(machine)).toEqual([]);
  });
});
