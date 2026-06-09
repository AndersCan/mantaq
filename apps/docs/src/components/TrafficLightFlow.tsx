import { useState, useCallback, useMemo } from "react";
import { Actor, state, event } from "@mantaq/core";
import { ActorFlow, buildGraph } from "@mantaq/visualizer";
import type { ActorGraph } from "@mantaq/visualizer";

function createTrafficLight() {
  const green = state("green")();
  const yellow = state("yellow")();
  const red = state("red")();
  const next = event("NEXT")();

  const actor = new Actor({
    inputs: [next],
    outputs: [],
    internal: [],
    states: [green, yellow, red],
    initial: green,
    context: {} as {},
    effects: {},
    transitions: {
      green: { NEXT: () => ({ state: yellow }) },
      yellow: { NEXT: () => ({ state: red }) },
      red: { NEXT: () => ({ state: green }) },
    },
  });

  return { actor, next };
}

export function TrafficLightFlow() {
  const [actorRef] = useState(() => createTrafficLight());
  const [graph, setGraph] = useState<ActorGraph>(() => buildGraph(actorRef.actor));
  const [currentState, setCurrentState] = useState("green");

  const handleNext = useCallback(() => {
    actorRef.actor.send(actorRef.next);
    const snap = actorRef.actor.snapshot();
    const name = snap.path[snap.path.length - 1];
    setCurrentState(name);
    setGraph(buildGraph(actorRef.actor));
  }, [actorRef]);

  const handleReset = useCallback(() => {
    const fresh = createTrafficLight();
    Object.assign(actorRef, fresh);
    setCurrentState("green");
    setGraph(buildGraph(fresh.actor));
  }, [actorRef]);

  const stateColor = useMemo(() => {
    switch (currentState) {
      case "green":
        return "#16a34a";
      case "yellow":
        return "#ca8a04";
      case "red":
        return "#dc2626";
      default:
        return "#374151";
    }
  }, [currentState]);

  return (
    <div
      style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", margin: "1rem 0" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem",
          background: "#1e293b",
          borderBottom: "1px solid #e5e7eb",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: "#94a3b8" }}>
          State: <strong style={{ color: stateColor }}>{currentState}</strong>
        </span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleNext}
            style={{
              fontFamily: "monospace",
              fontSize: "0.85rem",
              padding: "0.4rem 0.8rem",
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              background: "#0f172a",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            NEXT &rarr;
          </button>
          <button
            onClick={handleReset}
            style={{
              fontFamily: "monospace",
              fontSize: "0.85rem",
              padding: "0.4rem 0.8rem",
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              background: "transparent",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </div>
      <div style={{ height: 400, position: "relative" }}>
        <ActorFlow graph={graph} />
      </div>
    </div>
  );
}
