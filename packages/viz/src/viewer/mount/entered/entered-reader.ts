import type { EnteredRun, EnteredWalk } from "./entered-walk.ts";
import type { VizDriver, VizMachine } from "../../../schema.ts";
import { arrowContextOf } from "../arrow-send.ts";
import type { ArrowSendContext } from "../arrow-send.ts";
import { enteredWalk } from "./entered-walk.ts";
import type { Focus } from "../focus.ts";
import type { ViewState } from "../view-state.ts";

export interface EnteredReaderOptions {
  focus: () => Focus;
  root: VizMachine;
  view: ViewState;
  driver: VizDriver | undefined;
}

/** The walk as the canvas shows it, worked out again at each call from the focus path and the live state. */
export interface EnteredReader {
  walk: () => EnteredWalk;
  /** Where arrow clicks send from now; undefined while the entered machine is drawn without its state. */
  arrows: () => ArrowSendContext | undefined;
  /** The entered machine that runs now; undefined at the root or while it is drawn without its state. */
  running: () => EnteredRun | undefined;
}

export function enteredReader(options: EnteredReaderOptions): EnteredReader {
  const { focus, root, view, driver } = options;
  function walk(): EnteredWalk {
    return enteredWalk(focus(), { root, live: view.live });
  }
  function arrows(): ArrowSendContext | undefined {
    return arrowContextOf(walk(), { machine: root, view, driver });
  }
  function running(): EnteredRun | undefined {
    const now = walk();
    return now.kind === "running" ? now.run : undefined;
  }
  return { walk, arrows, running };
}
