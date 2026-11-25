import type { VizMachine } from "../schema.ts";

/** "" (the machine's own actor) then each actor returned beside it; [] below three machines. */
export function partsOf(machine: VizMachine): string[] {
  return machine.actors.length >= 2 ? ["", ...machine.actors] : [];
}

/** The actor an id belongs to (`a` or `a.…`); "" for the machine's own. */
export function partOf(machine: VizMachine, id: string): string {
  return machine.actors.find((actor) => id === actor || id.startsWith(`${actor}.`)) ?? "";
}

export function partName(machine: VizMachine, part: string): string {
  return part === "" ? machine.id : part;
}

/** Each board's parts as drawn, so a part opened again is the same machine and keeps its layout. */
const cutParts = new WeakMap<VizMachine, Map<string, VizMachine>>();

/** The machine as one part draws it: its own states, regions, maps and arrows, and no actors. */
export function partMachine(machine: VizMachine, part: string): VizMachine {
  const cut = cutParts.get(machine) ?? new Map<string, VizMachine>();
  cutParts.set(machine, cut);
  const known = cut.get(part);
  if (known !== undefined) return known;
  const drawn = cutPart(machine, { part });
  cut.set(part, drawn);
  return drawn;
}

interface CutOptions {
  part: string;
}

function cutPart(machine: VizMachine, options: CutOptions): VizMachine {
  const { part } = options;
  const inPart = (id: string): boolean => partOf(machine, id) === part;
  const messages = machine.fuzz?.messages.filter(
    (message) => inPart(message.from) && inPart(message.to),
  );
  const edges = machine.edges.filter((edge) => inPart(edge.from));
  return {
    ...machine,
    id: partName(machine, part),
    initial:
      part === ""
        ? machine.initial
        : (machine.states.find((s) => s.region === part && s.initial)?.id ?? null),
    regions: machine.regions.filter((r) => inPart(r) && r !== part),
    maps: machine.maps.filter(inPart),
    actors: [],
    states: machine.states
      .filter((state) => inPart(state.id))
      .map((state) => (state.region === part ? { ...state, region: null } : state)),
    edges,
    events: machine.events.filter((event) => edges.some((edge) => edge.event === event.id)),
    fuzz:
      machine.fuzz === null || messages === undefined
        ? machine.fuzz
        : { ...machine.fuzz, messages },
  };
}
