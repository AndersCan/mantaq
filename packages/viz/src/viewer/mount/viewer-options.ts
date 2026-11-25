import type { EnteredMachine } from "../graph.ts";
import type { VizDriver, VizLiveState, VizOutputRoutes } from "../../schema.ts";

export interface ViewerOptions {
  /** Machine to show; defaults to the first. */
  machine?: string;
  /** Live steps (from `?step=`) replayed through `driver`; ignored without one. */
  steps?: ReadonlyArray<string>;
  /**
   * Runs the machine for real: steps go to the driver and the cursor follows its state.
   * The driver runs one machine.
   */
  driver?: VizDriver;
  /** Name of a run in the shown machine's `runs` to open on (from `?run=`). Wins over `steps`. Replays only with a `driver`. */
  run?: string;
  /** Payload fields changed in the send forms, as `event=<json object>` (from `?payload=`); they win over `values`. */
  payloads?: ReadonlyArray<string>;
  /** Old links: a field value by name, as `name=<json>` (from `?value=`), for every event with a field of that name. */
  values?: ReadonlyArray<string>;
  /** The machines to open from the root, one value per step (from `?focus=`): a machine's name on a board, else the state that embeds the next machine. Values that do not resolve are dropped. */
  focus?: ReadonlyArray<string>;
  /** Called after every walk, payload change or move along the focus path, e.g. to keep the URL shareable. */
  onNavigate?: (where: {
    machine: string;
    steps: string[];
    payloads: string[];
    focus: string[];
  }) => void;
  /** Live: where each machine's outputs go, so a step can name the machine it told. Unset: output names only. */
  routes?: VizOutputRoutes;
  /** Live only (ignored without `driver`): a first "Screen" tab, open by default, holding what this returns for the cursor's state, or, while a state is selected, for that state as a throwaway copy reaches it. */
  screen?: (state: VizLiveState) => Node;
  /** Open with only the diagram and a "Show controls" button, e.g. a docs page that explains one idea. Default false. */
  diagramOnly?: boolean;
  /** Called when the reader enters a machine node, before the viewer draws it: the embedded machine's id and the state that embeds it. The viewer shows that machine itself. */
  onEnter?: (entered: EnteredMachine) => void;
}
