import { Actor, VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { states, events } from "@mantaq/sugar";
import { setActor, $graph, $layoutOptions } from "../src/index.ts";

const s = states("idling", "working", "timeout", "reviewing", "completed", "failed");
s.completed = s.completed.final();

const e = events("START", "FINISH", "APPROVE", "REJECT", "RETRY", "RESET");
const { WORK_TIMEOUT: workingTimeoutEvent } = events("WORK_TIMEOUT");

const clock = new VirtualClock();

const effectDefs: Array<{ name: string; state: string; ms: number }> = [
  { name: "work timeout (4s)", state: "working", ms: 4000 },
];

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

const stateLabel = document.getElementById("current-state")!;
const buttonsEl = document.getElementById("buttons")!;

const eventNames = ["START", "FINISH", "APPROVE", "REJECT", "RETRY", "RESET"] as const;

let actor: AnyActor;
const eventBtns = new Map<string, HTMLButtonElement>();

function initButtons() {
  const spacer = document.createElement("span");
  spacer.style.width = "8px";

  for (const name of eventNames) {
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.addEventListener("click", () => {
      actor.send(e[name]);
    });
    buttonsEl.appendChild(btn);
    eventBtns.set(name, btn);
  }
  buttonsEl.appendChild(spacer);

  for (const def of effectDefs) {
    const btn = document.createElement("button");
    btn.textContent = def.name;
    btn.className = "effect-btn";
    btn.dataset.state = def.state;
    btn.addEventListener("click", () => {
      clock.advance(def.ms);
    });
    buttonsEl.appendChild(btn);
  }
}

function updateButtons() {
  const graph = $graph.get();
  if (!graph) return;

  const activeNames: string[] = [];
  for (const node of graph.nodes) {
    if (node.isActive) activeNames.push(node.label);
  }
  stateLabel.textContent = `State: ${activeNames.join(", ")}`;

  const available = new Set<string>();
  const transitions = actor.options?.transitions;
  if (transitions) {
    for (const name of activeNames) {
      const stateTrans = transitions[name];
      if (stateTrans) {
        for (const evtName of Object.keys(stateTrans)) {
          available.add(evtName);
        }
      }
    }
    const anyTrans = transitions["Any"];
    if (anyTrans) {
      for (const evtName of Object.keys(anyTrans)) {
        available.add(evtName);
      }
    }
  }

  for (const [name, btn] of eventBtns) {
    btn.disabled = !available.has(name);
  }

  for (const btn of buttonsEl.querySelectorAll(".effect-btn")) {
    const btnEl = btn as HTMLButtonElement;
    btnEl.style.display = activeNames.includes(btnEl.dataset.state ?? "") ? "" : "none";
  }
}

type LayoutPreset = {
  label: string;
  opts: Parameters<typeof $layoutOptions.set>[0];
};

const presets: LayoutPreset[] = [
  {
    label: "→ RIGHT",
    opts: { direction: "RIGHT" },
  },
  {
    label: "↓ DOWN",
    opts: { direction: "DOWN" },
  },
  {
    label: "➡ RIGHT + order",
    opts: {
      direction: "RIGHT",
      elkOptions: { "elk.layered.considerModelOrder": "true" },
    },
  },
  {
    label: "⬇ DOWN + order",
    opts: {
      direction: "DOWN",
      elkOptions: { "elk.layered.considerModelOrder": "true" },
    },
  },
  {
    label: "➡ RIGHT + simplex",
    opts: {
      direction: "RIGHT",
      elkOptions: {
        "elk.layered.considerModelOrder": "true",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      },
    },
  },
  {
    label: "⬇ DOWN + simplex",
    opts: {
      direction: "DOWN",
      elkOptions: {
        "elk.layered.considerModelOrder": "true",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      },
    },
  },
];

function applyPreset(preset: LayoutPreset) {
  $layoutOptions.set(preset.opts);
  void setActor(actor);
}

function initLayoutControls() {
  const el = document.getElementById("layout-controls")!;
  for (const preset of presets) {
    const btn = document.createElement("button");
    btn.textContent = preset.label;
    btn.addEventListener("click", () => applyPreset(preset));
    el.appendChild(btn);
  }
}

interface ElkCtlDef {
  key: string;
  label: string;
  values: string[];
}

const elkCtlDefs: ElkCtlDef[] = [
  {
    key: "elk.layered.considerModelOrder.strategy",
    label: "modelOrder",
    values: ["NODES_AND_EDGES", "PREFER_EDGES", "PREFER_NODES"],
  },
  {
    key: "elk.layered.crossingMinimization.forceNodeModelOrder",
    label: "forceOrder",
    values: ["true"],
  },
  {
    key: "elk.layered.crossingMinimization.semiInteractive",
    label: "semiInteractive",
    values: ["true"],
  },
  {
    key: "elk.layered.crossingMinimization.strategy",
    label: "crossMin",
    values: ["LAYER_SWEEP", "INTERACTIVE"],
  },
  {
    key: "elk.layered.layering.strategy",
    label: "layering",
    values: ["NETWORK_SIMPLEX", "LONGEST_PATH", "COFFMAN_GRAHAM", "MIN_WIDTH"],
  },
];

const elkCtlBtns = new Map<string, HTMLButtonElement>();

function elkCtlLabel(def: ElkCtlDef): string {
  const current = $layoutOptions.get().elkOptions?.[def.key];
  return current ? `${def.label}:${current}` : `${def.label}:_`;
}

function cycleElkOpt(def: ElkCtlDef) {
  const opts = { ...$layoutOptions.get() };
  const elk = { ...opts.elkOptions };
  const current = elk[def.key];
  const idx = def.values.indexOf(current ?? "");
  if (idx === -1) {
    elk[def.key] = def.values[0];
  } else if (idx < def.values.length - 1) {
    elk[def.key] = def.values[idx + 1];
  } else {
    delete elk[def.key];
  }
  opts.elkOptions = elk;
  $layoutOptions.set(opts);
  void setActor(actor);
}

function initElkControls() {
  const el = document.getElementById("elk-controls")!;
  for (const def of elkCtlDefs) {
    const btn = document.createElement("button");
    btn.textContent = elkCtlLabel(def);
    btn.addEventListener("click", () => {
      cycleElkOpt(def);
      btn.textContent = elkCtlLabel(def);
    });
    el.appendChild(btn);
    elkCtlBtns.set(def.key, btn);
  }
}

initButtons();
initLayoutControls();
initElkControls();

$graph.listen(() => {
  requestAnimationFrame(() => updateButtons());
});

actor = createWorkflowActor() as unknown as AnyActor;
actor.on("change", () => {
  void setActor(actor);
});
void setActor(actor);
