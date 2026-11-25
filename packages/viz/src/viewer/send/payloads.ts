import type { VizEvent, VizJson } from "../../schema.ts";
import { Either } from "@mantaq/utils";
import type { Values } from "../fill.ts";

/** Machine id → event id → the payload fields a person changed in that event's send form; every send of the event uses them. */
export type Payloads = Readonly<Record<string, Readonly<Record<string, Values>>>>;

/** Which machine's event a payload belongs to: the same event id can take other fields in another machine. */
export interface PayloadOf {
  machine: string;
  event: string;
}

export interface PayloadEdit extends PayloadOf {
  field: string;
  /** undefined drops the change, so the field goes back to its prefill. */
  value: VizJson | undefined;
}

/** The fields changed for one event of one machine; {} when none are. */
export function changedFields(payloads: Payloads, target: PayloadOf): Values {
  return payloads[target.machine]?.[target.event] ?? {};
}

export function withEdit(payloads: Payloads, edit: PayloadEdit): Payloads {
  const { [edit.machine]: events = {}, ...machines } = payloads;
  const { [edit.event]: before = {}, ...others } = events;
  const { [edit.field]: _dropped, ...kept } = before;
  const fields = edit.value === undefined ? kept : { ...kept, [edit.field]: edit.value };
  const changed = Object.keys(fields).length === 0 ? others : { ...others, [edit.event]: fields };
  if (Object.keys(changed).length === 0) return machines;
  return { ...machines, [edit.machine]: changed };
}

/** Machines from `wins` replace the same event of `base`; the other events of both stay. */
export function mergedPayloads(base: Payloads, wins: Payloads): Payloads {
  const merged: Record<string, Readonly<Record<string, Values>>> = { ...base };
  for (const [machine, events] of Object.entries(wins)) {
    merged[machine] = { ...base[machine], ...events };
  }
  return merged;
}

function isFields(value: unknown): value is Values {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `machine:event=<json>` per event, as kept in the address (`?payload=`). */
export function encodePayloads(payloads: Payloads): string[] {
  const encoded: string[] = [];
  for (const [machine, events] of Object.entries(payloads)) {
    for (const [event, fields] of Object.entries(events)) {
      encoded.push(`${machine}:${event}=${JSON.stringify(fields)}`);
    }
  }
  return encoded;
}

function parsedFields(text: string): Values | undefined {
  const parsed: unknown = Either.getRight(Either.from((): unknown => JSON.parse(text)));
  return isFields(parsed) ? parsed : undefined;
}

export interface DecodeOptions {
  /** Machine ids of the document: a `machine:` prefix counts only when it names one. */
  machines: ReadonlyArray<string>;
  /** The machine a bare `event=<json>` entry of an old link belongs to: the one `?machine=` opens. */
  shown: string;
}

/** Splits `machine:event`; without a known machine in front, the whole head is an event of `shown`. */
function payloadOf(head: string, options: DecodeOptions): PayloadOf {
  const colon = head.indexOf(":");
  const machine = head.slice(0, colon);
  if (colon > 0 && options.machines.includes(machine)) {
    return { machine, event: head.slice(colon + 1) };
  }
  return { machine: options.shown, event: head };
}

/** The inverse of `encodePayloads`, also reading old bare entries; an entry with no event, no `=`, or JSON that is not an object is skipped. */
export function decodePayloads(encoded: ReadonlyArray<string>, options: DecodeOptions): Payloads {
  let payloads: Payloads = {};
  for (const entry of encoded) {
    const at = entry.indexOf("=");
    const fields = at <= 0 ? undefined : parsedFields(entry.slice(at + 1));
    const target = payloadOf(entry.slice(0, at), options);
    if (fields === undefined || target.event === "") continue;
    payloads = mergedPayloads(payloads, { [target.machine]: { [target.event]: fields } });
  }
  return payloads;
}

/** The events of one machine, for old links. */
export interface MachineEvents {
  id: string;
  events: ReadonlyArray<VizEvent>;
}

/** Old `?value=name=<json>` links set a field by name for every event: each event of each machine with a field of that name gets the value. */
export function legacyPayloads(values: Values, machines: ReadonlyArray<MachineEvents>): Payloads {
  let payloads: Payloads = {};
  for (const machine of machines) {
    for (const event of machine.events) {
      for (const field of event.payload ?? []) {
        const linked = values[field.name];
        if (linked === undefined) continue;
        const edit = { machine: machine.id, event: event.id, field: field.name, value: linked };
        payloads = withEdit(payloads, edit);
      }
    }
  }
  return payloads;
}
