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
  /** Values events are sent with, as `name=<json>` (from `?value=`); the Context tab sets them. */
  values?: ReadonlyArray<string>;
  /** Called after every walk, or value change, e.g. to keep the URL shareable. */
  onNavigate?: (where: { machine: string; steps: string[]; values: string[] }) => void;
  /** Live: where each machine's outputs go, so a step can name the machine it told. Unset: output names only. */
  routes?: VizOutputRoutes;
  /** Live only (ignored without `driver`): a first "Screen" tab, open by default, holding what this returns for the cursor's state, or, while a state is selected, for that state as a throwaway copy reaches it. */
  screen?: (state: VizLiveState) => Node;
  /** Open with only the diagram and a "Show controls" button, e.g. a docs page that explains one idea. Default false. */
  diagramOnly?: boolean;
}
