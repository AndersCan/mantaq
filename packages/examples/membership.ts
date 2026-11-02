/**
 * Membership: request, approve, decline, remove.
 *
 * One machine per applicant. The in-flight request lives in the
 * `requestPending` state payload, so there is no nullable context field and
 * no "no pending request" branch to defend.
 *
 *   notMember → requestPending → enrolled → removed (final)
 *                    ↓ decline / ineligible
 *                notMember
 *
 * The port returns `Promise<Either<PortError, T>>`; `Either.match` turns the
 * result into an event inside `withPromise`. Declared outputs
 * (`memberEnrolled`, `memberRemoved`) feed a second machine, the member list,
 * through `onOutput`.
 *
 * `records` is the persisted shape. `initialStateFromRecords` is a pure
 * function from records to the initial state, so restore needs no replay.
 */

import { Actor, state, event } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { withPromise, onOutput } from "@mantaq/sugar";
import { Either } from "@mantaq/utils";

export type MembershipRequest = { memberId: string; note: string };
type Ineligible = { reason: string };
type Eligible = { memberId: string };

export type MembershipPort = {
  checkEligibility(request: MembershipRequest): Promise<Either<Ineligible, Eligible>>;
};

export type MembershipRecords = {
  memberId: string;
  registry: ReadonlyArray<string>;
  removed: ReadonlyArray<string>;
  outbox: ReadonlyArray<MembershipRequest>;
};

const notMember = state("notMember")();
const requestPending = state("requestPending")<MembershipRequest>();
const enrolled = state("enrolled")();
const removed = state("removed")().final();

const request = event("request")<MembershipRequest>();
const approve = event("approve")();
const decline = event("decline")();
const remove = event("remove")();
const eligible = event("eligible")<Eligible>();
const ineligible = event("ineligible")<Ineligible>();

const memberEnrolled = event("memberEnrolled")<{ memberId: string }>();
const memberRemoved = event("memberRemoved")<{ memberId: string }>();

const fresh: MembershipRecords = { memberId: "member", registry: [], removed: [], outbox: [] };

const approveEveryone: MembershipPort = {
  checkEligibility: (r) => Promise.resolve(Either.right({ memberId: r.memberId })),
};

type Checked = ReturnType<typeof eligible.create> | ReturnType<typeof ineligible.create>;

export function initialStateFromRecords(records: MembershipRecords) {
  if (records.removed.includes(records.memberId)) return removed;
  if (records.registry.includes(records.memberId)) return enrolled;
  const pending = records.outbox.find((r) => r.memberId === records.memberId);
  if (pending) return requestPending.create(pending);
  return notMember;
}

export function createMembership(options: {
  clock: Clock;
  port?: MembershipPort;
  records?: MembershipRecords;
}) {
  const { clock, port = approveEveryone, records = fresh } = options;
  const { memberId } = records;
  const actor = Actor({
    inputs: [request, approve, decline, remove],
    internal: [eligible, ineligible],
    outputs: [memberEnrolled, memberRemoved],
    states: [notMember, requestPending, enrolled, removed],
    initial: initialStateFromRecords(records),
    clock,
    setup: (m) => {
      m.on(notMember, {
        event: request,
        to: [requestPending],
        handler: (e) => ({ state: requestPending.create(e.payload) }),
      });
      m.effect(requestPending, {
        name: "checkEligibility",
        sends: [eligible, ineligible],
        fn: (input) =>
          withPromise({
            promise: port.checkEligibility(input.state.payload),
            signal: input.signal,
            emit: input.emit,
            events: {
              success: (result) =>
                Either.match<typeof result, Checked>(result, {
                  onLeft: (reason) => ineligible.create(reason),
                  onRight: (ok) => eligible.create(ok),
                }),
              error: (cause) => ineligible.create({ reason: String(cause) }),
            },
          }),
      });
      m.on(requestPending, { event: eligible, handler: () => ({}) });
      m.on(requestPending, {
        event: ineligible,
        to: [notMember],
        handler: () => ({ state: notMember }),
      });
      m.on(requestPending, {
        event: decline,
        to: [notMember],
        handler: () => ({ state: notMember }),
      });
      m.on(requestPending, {
        event: approve,
        to: [enrolled],
        handler: () => ({ state: enrolled, emit: [memberEnrolled.create({ memberId })] }),
      });
      m.on(enrolled, {
        event: remove,
        to: [removed],
        handler: () => ({ state: removed, emit: [memberRemoved.create({ memberId })] }),
      });
    },
  });
  return { actor };
}

export function createMemberList(options: {
  clock: Clock;
  members?: ReadonlyArray<string>;
  sources?: ReadonlyArray<{ actor: Parameters<typeof onOutput>[0] }>;
}) {
  const listening = state("listening")();
  const initialContext: { members: Array<string> } = { members: [...(options.members ?? [])] };
  const actor = Actor({
    inputs: [memberEnrolled, memberRemoved],
    states: [listening],
    initial: listening,
    clock: options.clock,
    context: initialContext,
    setup: (m) => {
      m.on(listening, {
        event: memberEnrolled,
        handler: (e, { context }) => {
          const current = context.get();
          if (!current.members.includes(e.payload.memberId)) {
            current.members.push(e.payload.memberId);
            context.set(current);
          }
          return {};
        },
      });
      m.on(listening, {
        event: memberRemoved,
        handler: (e, { context }) => {
          const current = context.get();
          current.members = current.members.filter((id) => id !== e.payload.memberId);
          context.set(current);
          return {};
        },
      });
    },
  });
  for (const source of options.sources ?? []) {
    onOutput(source.actor, (e) => {
      if (memberEnrolled.is(e) || memberRemoved.is(e)) actor.send(e);
    });
  }
  return { actor };
}
