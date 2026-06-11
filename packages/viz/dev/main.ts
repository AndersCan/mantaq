import { createElement, useState, useMemo, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Actor, VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { states, events } from "@mantaq/sugar";
import { buildGraph, type ActorGraph, type GraphNode } from "../src/graph.ts";
import { ActorFlow } from "../src/components/actor-flow.tsx";

const s = states("idling", "working", "timeout", "reviewing", "completed", "failed");
s.completed = s.completed.final();

const e = events("START", "FINISH", "APPROVE", "REJECT", "RETRY", "RESET");
const { WORK_TIMEOUT: workingTimeoutEvent } = events("WORK_TIMEOUT");

const clock = new VirtualClock();

function createWorkflowActor() {
  return new Actor({
    inputs: [e.START, e.FINISH, e.APPROVE, e.REJECT, e.RETRY, e.RESET],
    outputs: [],
    internal: [workingTimeoutEvent],
    states: [s.failed, s.completed, s.reviewing, s.timeout, s.working, s.idling],
    initial: s.idling,
    clock,
    context: {} as Record<string, never>,
    effects: {
      working: [
        (input: any) => {
          input.clock.setTimeout(4000, () => {
            if (input.signal.aborted) return;
            input.emit({ id: "WORK_TIMEOUT" });
          });
        },
      ],
    },
    transitions: {
      idling: {
        START: () => ({ state: s.working }),
      },
      working: {
        FINISH: () => ({ state: s.reviewing }),
        WORK_TIMEOUT: () => ({ state: s.timeout }),
      },
      reviewing: {
        APPROVE: () => ({ state: s.completed }),
        REJECT: () => ({ state: s.failed }),
      },
      failed: {
        RETRY: () => ({ state: s.working }),
        RESET: () => ({ state: s.idling }),
      },
      completed: {
        RESET: () => ({ state: s.idling }),
      },
      timeout: {
        FINISH: () => ({ state: s.reviewing }),
      },
    },
  });
}

let actor: AnyActor = createWorkflowActor() as unknown as AnyActor;
const eventNames = ["START", "FINISH", "APPROVE", "REJECT", "RETRY", "RESET"] as const;

function App() {
  const [graph, setGraph] = useState<ActorGraph>(() => buildGraph(actor));
  const [currentState, setCurrentState] = useState("idling");

  const sendEvent = useCallback((name: string) => {
    actor.send(e[name as keyof typeof e]);
    const snap = actor.snapshot();
    const active = snap.path[snap.path.length - 1];
    setCurrentState(active);
    setGraph(buildGraph(actor));
  }, []);

  const available = useMemo(() => {
    const activeNames = graph.nodes
      .filter((n: GraphNode) => n.isActive)
      .map((n: GraphNode) => n.label);
    const avail = new Set<string>();
    const transitions = actor.options?.transitions as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (transitions) {
      for (const name of activeNames) {
        const stateTrans = transitions[name];
        if (stateTrans) {
          for (const evtName of Object.keys(stateTrans)) {
            avail.add(evtName);
          }
        }
      }
    }
    return avail;
  }, [graph]);

  useEffect(() => {
    const stateEl = document.getElementById("current-state");
    if (stateEl) stateEl.textContent = `State: ${currentState}`;
  }, [currentState]);

  useEffect(() => {
    const buttonsEl = document.getElementById("buttons");
    if (!buttonsEl) return;
    buttonsEl.innerHTML = "";
    for (const name of eventNames) {
      const btn = document.createElement("button");
      btn.textContent = name;
      btn.disabled = !available.has(name);
      btn.addEventListener("click", () => sendEvent(name));
      buttonsEl.appendChild(btn);
    }
  }, [available, sendEvent]);

  return createElement(ActorFlow, { graph });
}

const root = createRoot(document.getElementById("root")!);
root.render(createElement(App));
