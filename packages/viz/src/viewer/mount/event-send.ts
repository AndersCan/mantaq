import { navigated, stepInto } from "./walk.ts";
import type { VizActorRef, VizDriver, VizMachine, VizStep } from "../../schema.ts";
import type { ExploreContext } from "../explore.ts";
import { payloadFor } from "../fill.ts";
import type { ViewerOptions } from "./viewer-options.ts";
import type { ViewState } from "./view-state.ts";

type SetValue = NonNullable<ExploreContext["live"]>["setValue"];

export interface ValueSetterContext {
  options: ViewerOptions;
  machine: VizMachine;
  view: ViewState;
  mark: () => void;
}

/** Sets (or, with undefined, clears) a value: the blocked arrows are worked out again and the host hears of it. Only the marks redraw, so the box being typed in keeps focus. */
export function valueSetter(context: ValueSetterContext): SetValue {
  const { options, machine, view, mark } = context;
  const setValue: SetValue = (name, value) => {
    const { [name]: _gone, ...rest } = view.values;
    view.values = value === undefined ? rest : { ...rest, [name]: value };
    view.blockedFor = undefined;
    navigated(options, { machine, view });
    mark();
  };
  return setValue;
}

/** One click that sends an event: to whom, and the arrow it came from. */
export interface EventClick {
  event: string;
  actor: VizActorRef | undefined;
  edge: string | undefined;
}

interface StepSendOptions {
  /** The event a Send press sent; the panel shows where it went. */
  sent?: ViewState["sent"];
}

export type StepSend = (step: VizStep, options?: StepSendOptions) => void;

export interface EventSenderContext {
  machine: VizMachine;
  view: ViewState;
  send: StepSend;
}

/** Sends one named event as a step, remembering the arrow it came from. */
export function eventSender(context: EventSenderContext): (click: EventClick) => void {
  const { machine, view, send } = context;
  return (click) => {
    const { event, actor, edge } = click;
    const step = eventStep(machine, { view, click });
    send(step, {
      sent: {
        event,
        ...(actor ? { actor } : {}),
        payload: step.payload,
        ...(edge === undefined ? {} : { edge }),
      },
    });
  };
}

export interface StepSenderContext {
  view: ViewState;
  driver: VizDriver | undefined;
  walked: (sent?: ViewState["sent"]) => void;
}

/** Sends a step to the driver and redraws; no driver, no step. */
export function stepSender(context: StepSenderContext): StepSend {
  const { view, driver, walked } = context;
  const send: StepSend = (step, options) => {
    if (driver === undefined) return;
    stepInto(view, { driver, step });
    walked(options?.sent);
  };
  return send;
}

interface EventStepOptions {
  view: ViewState;
  click: EventClick;
}

/** The step a click on `event` sends: its payload comes from the values set in the Context tab. */
function eventStep(
  machine: VizMachine,
  options: EventStepOptions,
): Extract<VizStep, { kind: "event" }> {
  const { view, click } = options;
  const { event, actor, edge } = click;
  const chosen = edge === undefined ? undefined : view.chosen.get(edge);
  const payload =
    chosen ??
    payloadFor(machine, event, { set: view.values, live: view.live, afters: view.afters });
  return { kind: "event", event, payload, ...(actor ? { actor } : {}) };
}
