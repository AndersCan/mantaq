import { navigated, stepInto } from "./walk.ts";
import type { VizActorRef, VizDriver, VizEdge, VizMachine, VizStep } from "../../schema.ts";
import { arrowPayload } from "./arrow-send.ts";
import type { PayloadEdit } from "../send/payloads.ts";
import { payloadFor } from "../fill.ts";
import type { ViewerOptions } from "./viewer-options.ts";
import type { ViewState } from "./view-state.ts";
import { withEdit } from "../send/payloads.ts";

export interface PayloadSetterContext {
  options: ViewerOptions;
  machine: VizMachine;
  view: ViewState;
  mark: () => void;
}

/** Changes (or, with undefined, drops the change to) one payload field: the blocked arrows are worked out again and the host hears of it. Only the marks redraw, so the box being typed in keeps focus. */
export function payloadSetter(context: PayloadSetterContext): (edit: PayloadEdit) => void {
  const { options, machine, view, mark } = context;
  return (edit) => {
    view.payloads = withEdit(view.payloads, edit);
    view.blockedFor = undefined;
    navigated(options, { machine, view });
    mark();
  };
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
  driver: VizDriver | undefined;
  send: StepSend;
}

/** Sends one named event as a step, remembering the arrow it came from. */
export function eventSender(context: EventSenderContext): (click: EventClick) => void {
  const { send } = context;
  return (click) => {
    const { event, actor, edge } = click;
    const step = eventStep(context, click);
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

/** The step a click sends: an arrow's payload is the one its send form shows. */
function eventStep(
  context: EventSenderContext,
  click: EventClick,
): Extract<VizStep, { kind: "event" }> {
  const { machine, view } = context;
  const { event, actor } = click;
  const edge: VizEdge | undefined = machine.edges.find((each) => each.id === click.edge);
  const payload =
    edge === undefined
      ? payloadFor(machine, event, {
          set: view.payloads[event] ?? {},
          live: view.live,
          afters: view.afters,
        })
      : arrowPayload({ machine, view, driver: context.driver }, edge);
  return { kind: "event", event, payload, ...(actor ? { actor } : {}) };
}
