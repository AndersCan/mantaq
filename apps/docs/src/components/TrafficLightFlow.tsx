import { useState, useCallback, useRef } from "react";
import { Actor, state, event } from "@mantaq/core";
import { ActorFlow, buildGraph } from "@mantaq/visualizer";
import type { ActorGraph } from "@mantaq/visualizer";

function createTrafficLight() {
  const green = state("green")();
  const yellow = state("yellow")();
  const red = state("red")();
  const next = event("NEXT")();

  return new Actor({
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
}

export function TrafficLightFlow() {
  const actor = useRef(createTrafficLight());
  const nextEvent = useRef(event("NEXT")());
  const [graph, setGraph] = useState<ActorGraph>(() => buildGraph(actor.current));
  const [currentState, setCurrentState] = useState("green");

  const handleNext = useCallback(() => {
    actor.current.send(nextEvent.current);
    const snap = actor.current.snapshot();
    const name = snap.path[snap.path.length - 1];
    setCurrentState(name);
    setGraph(buildGraph(actor.current));
  }, []);

  const handleReset = useCallback(() => {
    actor.current = createTrafficLight();
    nextEvent.current = event("NEXT")();
    setCurrentState("green");
    setGraph(buildGraph(actor.current));
  }, []);

  const stateColor: string =
    currentState === "green"
      ? "#16a34a"
      : currentState === "yellow"
        ? "#ca8a04"
        : currentState === "red"
          ? "#dc2626"
          : "#374151";

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
