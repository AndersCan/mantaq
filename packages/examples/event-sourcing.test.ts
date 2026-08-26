/**
 * Event sourcing — append-only event log, state derivation from replay,
 * multiple read models (projections), time travel debugging.
 *
 * This is a UserLand pattern. Core provides primitives (Actor, state, event,
 * context, effects). Everything above — event log, fold, snapshot, projection
 * wiring — is composed with those primitives. No core changes needed.
 *
 * Models a bank account aggregate with event sourcing:
 *   - Commands: open, deposit, withdraw, close
 *   - Domain events: ACCOUNT_OPENED, MONEY_DEPOSITED, MONEY_WITHDRAWN, ACCOUNT_CLOSED
 *   - State derived by folding events (no mutable context for balance)
 *   - Snapshot at version N for efficient rebuild
 *   - Time travel: reconstruct state at any version
 *
 * Structure:
 *   account (aggregate) → stores events in context, derives balance via fold
 *   balanceProjection → derived read model, rebuilt from event log
 *   bankingSystem (parent) → wires aggregate + projection, forwards events
 *
 * UserLand patterns demonstrated:
 *   1. Event log in context — append-only, UserLand decides compaction policy
 *   2. State derivation via fold — UserLand fold function over event array
 *   3. Snapshot/restore — UserLand serializes context, rebuilds via fold
 *   4. Time travel — foldEventsToVersion(events, n) for random access
 *   5. Projection wiring — parent forwards events to read models
 *   6. Replay testing — feed event log into fresh projection actor
 */

import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

// ── Domain Events ──────────────────────────────────────────────────

type AccountEvent =
  | { type: "ACCOUNT_OPENED"; payload: { accountId: string; initialBalance: number; at: number } }
  | { type: "MONEY_DEPOSITED"; payload: { amount: number; at: number } }
  | { type: "MONEY_WITHDRAWN"; payload: { amount: number; at: number } }
  | { type: "ACCOUNT_CLOSED"; payload: { reason: string; at: number } };

// ── States ─────────────────────────────────────────────────────────

const {
  active: activeState,
  closed: closedStateRef,
  tracking: trackingState,
} = states("active", "closed", "tracking");
const closedState = closedStateRef.final();

// ── Input Events (commands) ────────────────────────────────────────

const openAccountCmd = event("OPEN_ACCOUNT")<{ accountId: string; initialBalance: number }>();
const depositCmd = event("DEPOSIT")<{ amount: number }>();
const withdrawCmd = event("WITHDRAW")<{ amount: number }>();
const closeAccountCmd = event("CLOSE_ACCOUNT")<{ reason: string }>();

// ── Internal Events ────────────────────────────────────────────────

const eventStoredEvt = event("EVENT_STORED")<{ event: AccountEvent }>();
const { REPLAY_COMPLETE: replayCompleteEvt } = events("REPLAY_COMPLETE");

// ── Context ────────────────────────────────────────────────────────

type AccountContext = {
  events: AccountEvent[];
  balance: number;
  version: number;
};

// ── Fold: derive state from events ─────────────────────────────────

function foldEvents(accountEvents: AccountEvent[]): { balance: number } {
  let balance = 0;
  for (const accountEvent of accountEvents) {
    switch (accountEvent.type) {
      case "ACCOUNT_OPENED":
        balance += accountEvent.payload.initialBalance;
        break;
      case "MONEY_DEPOSITED":
        balance += accountEvent.payload.amount;
        break;
      case "MONEY_WITHDRAWN":
        balance -= accountEvent.payload.amount;
        break;
      case "ACCOUNT_CLOSED":
        break;
    }
  }
  return { balance };
}

function foldEventsToVersion(
  accountEvents: AccountEvent[],
  options: { version: number },
): { balance: number } {
  return foldEvents(accountEvents.slice(0, options.version));
}

// ── Snapshot ───────────────────────────────────────────────────────

type AccountSnapshot = {
  version: number;
  balance: number;
  events: AccountEvent[];
};

function takeSnapshot(context: AccountContext): AccountSnapshot {
  return {
    version: context.version,
    balance: context.balance,
    events: [...context.events],
  };
}

function restoreFromSnapshot(
  snapshot: AccountSnapshot,
  options: { newEvents: AccountEvent[] },
): { events: AccountEvent[]; balance: number; version: number } {
  const allEvents = [...snapshot.events, ...options.newEvents];
  const { balance } = foldEvents(allEvents);
  return {
    events: allEvents,
    balance,
    version: snapshot.version + options.newEvents.length,
  };
}

// ── Aggregate Actor ────────────────────────────────────────────────

function createAccountAggregate(clock?: VirtualClock) {
  const c = clock ?? VirtualClock();

  const initialContext: AccountContext = { events: [], balance: 0, version: 0 };

  const actor = Actor({
    inputs: [openAccountCmd, depositCmd, withdrawCmd, closeAccountCmd],
    outputs: [eventStoredEvt],
    internal: [replayCompleteEvt],
    states: [activeState, closedState],
    initial: activeState,
    clock: c,
    context: initialContext,
    setup: (m) => {
      m.on(activeState, {
        eventRef: openAccountCmd,
        handler: (evt, { context }) => {
          const current = context.get();
          const domainEvent: AccountEvent = {
            type: "ACCOUNT_OPENED",
            payload: {
              accountId: evt.payload.accountId,
              initialBalance: evt.payload.initialBalance,
              at: c.now(),
            },
          };
          current.events = [...current.events, domainEvent];
          current.balance += evt.payload.initialBalance;
          current.version += 1;
          context.set(current);
          return { emit: [eventStoredEvt.create({ event: domainEvent })] };
        },
      });
      m.on(activeState, {
        eventRef: depositCmd,
        handler: (evt, { context }) => {
          const current = context.get();
          if (evt.payload.amount <= 0) return {};
          const domainEvent: AccountEvent = {
            type: "MONEY_DEPOSITED",
            payload: {
              amount: evt.payload.amount,
              at: c.now(),
            },
          };
          current.events = [...current.events, domainEvent];
          current.balance += evt.payload.amount;
          current.version += 1;
          context.set(current);
          return { emit: [eventStoredEvt.create({ event: domainEvent })] };
        },
      });
      m.on(activeState, {
        eventRef: withdrawCmd,
        handler: (evt, { context }) => {
          const current = context.get();
          if (evt.payload.amount <= 0 || evt.payload.amount > current.balance) return {};
          const domainEvent: AccountEvent = {
            type: "MONEY_WITHDRAWN",
            payload: {
              amount: evt.payload.amount,
              at: c.now(),
            },
          };
          current.events = [...current.events, domainEvent];
          current.balance -= evt.payload.amount;
          current.version += 1;
          context.set(current);
          return { emit: [eventStoredEvt.create({ event: domainEvent })] };
        },
      });
      m.on(activeState, {
        eventRef: closeAccountCmd,
        handler: (evt, { context }) => {
          const current = context.get();
          const domainEvent: AccountEvent = {
            type: "ACCOUNT_CLOSED",
            payload: {
              reason: evt.payload.reason,
              at: c.now(),
            },
          };
          current.events = [...current.events, domainEvent];
          current.version += 1;
          context.set(current);
          return { state: closedState, emit: [eventStoredEvt.create({ event: domainEvent })] };
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Balance Projection (read model) ────────────────────────────────

type BalanceProjectionContext = {
  balance: number;
  lastVersion: number;
  accountEvents: AccountEvent[];
};

function createBalanceProjection(clock?: VirtualClock) {
  const c = clock ?? VirtualClock();

  const initialContext: BalanceProjectionContext = {
    balance: 0,
    lastVersion: 0,
    accountEvents: [],
  };

  const actor = Actor({
    inputs: [eventStoredEvt],
    outputs: [],
    internal: [],
    states: [trackingState],
    initial: trackingState,
    clock: c,
    context: initialContext,
    setup: (m) => {
      m.on(trackingState, {
        eventRef: eventStoredEvt,
        handler: (evt, { context }) => {
          const current = context.get();
          current.accountEvents = [...current.accountEvents, evt.payload.event];
          current.balance = foldEvents(current.accountEvents).balance;
          current.lastVersion = current.accountEvents.length;
          context.set(current);
          return {};
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("event sourcing — bank account aggregate", () => {
  it("sets a zero balance with an empty event log initially", () => {
    const { actor } = createAccountAggregate();
    expect({
      events: actor.context.events,
      balance: actor.context.balance,
      version: actor.context.version,
    }).toEqual({ events: [], balance: 0, version: 0 });
  });

  it("adds an ACCOUNT_OPENED event and sets the balance", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    expect({
      eventCount: actor.context.events.length,
      firstType: actor.context.events[0]?.type,
      balance: actor.context.balance,
      version: actor.context.version,
    }).toEqual({ eventCount: 1, firstType: "ACCOUNT_OPENED", balance: 1000, version: 1 });
  });

  it("adds a MONEY_DEPOSITED event and updates the balance upward", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));

    expect({
      eventCount: actor.context.events.length,
      lastType: actor.context.events[1]?.type,
      balance: actor.context.balance,
      version: actor.context.version,
    }).toEqual({ eventCount: 2, lastType: "MONEY_DEPOSITED", balance: 1500, version: 2 });
  });

  it("adds a MONEY_WITHDRAWN event and updates the balance downward", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(withdrawCmd.create({ amount: 300 }));

    expect({
      balance: actor.context.balance,
      version: actor.context.version,
    }).toEqual({ balance: 700, version: 2 });
  });

  it("ignores WITHDRAW when the balance is insufficient", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 100 }));
    actor.send(withdrawCmd.create({ amount: 500 }));

    expect({
      eventCount: actor.context.events.length,
      balance: actor.context.balance,
    }).toEqual({ eventCount: 1, balance: 100 });
  });

  it("ignores DEPOSIT when the amount is not positive", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 100 }));
    actor.send(depositCmd.create({ amount: -50 }));

    expect({
      eventCount: actor.context.events.length,
      balance: actor.context.balance,
    }).toEqual({ eventCount: 1, balance: 100 });
  });

  it("adds an ACCOUNT_CLOSED event and sets the account closed", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(closeAccountCmd.create({ reason: "user requested" }));

    expect({
      eventCount: actor.context.events.length,
      lastType: actor.context.events[1]?.type,
      matches: matches(actor, "closed"),
      done: actor.snapshot().done,
    }).toEqual({ eventCount: 2, lastType: "ACCOUNT_CLOSED", matches: true, done: true });
  });

  it("ignores commands after the account closes", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(closeAccountCmd.create({ reason: "done" }));
    actor.send(depositCmd.create({ amount: 100 }));

    expect({
      eventCount: actor.context.events.length,
      balance: actor.context.balance,
    }).toEqual({ eventCount: 2, balance: 1000 });
  });

  it("keeps the full event log across many operations", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 200 }));
    actor.send(withdrawCmd.create({ amount: 100 }));
    actor.send(depositCmd.create({ amount: 50 }));
    actor.send(withdrawCmd.create({ amount: 25 }));

    expect({
      eventCount: actor.context.events.length,
      balance: actor.context.balance,
      version: actor.context.version,
    }).toEqual({ eventCount: 5, balance: 1125, version: 5 });

    const types = actor.context.events.map((domainEvent) => domainEvent.type);
    expect(types).toEqual([
      "ACCOUNT_OPENED",
      "MONEY_DEPOSITED",
      "MONEY_WITHDRAWN",
      "MONEY_DEPOSITED",
      "MONEY_WITHDRAWN",
    ]);
  });
});

describe("event sourcing — state derivation via fold", () => {
  it("builds the balance by folding the event log", () => {
    const events: AccountEvent[] = [
      { type: "ACCOUNT_OPENED", payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 } },
      { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      { type: "MONEY_WITHDRAWN", payload: { amount: 200, at: 2 } },
    ];

    const { balance } = foldEvents(events);
    expect(balance).toBe(1300);
  });

  it("builds the balance at a specific version from the event log", () => {
    const events: AccountEvent[] = [
      { type: "ACCOUNT_OPENED", payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 } },
      { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      { type: "MONEY_WITHDRAWN", payload: { amount: 200, at: 2 } },
      { type: "MONEY_DEPOSITED", payload: { amount: 100, at: 3 } },
    ];

    const balances = [0, 1, 2, 3, 4].map(
      (target) => foldEventsToVersion(events, { version: target }).balance,
    );
    expect(balances).toEqual([0, 1000, 1500, 1300, 1400]);
  });
});

describe("event sourcing — snapshot and rebuild", () => {
  it("creates a snapshot capturing version, balance, and events", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));

    const snapshot = takeSnapshot(actor.context);
    expect({
      version: snapshot.version,
      balance: snapshot.balance,
      eventCount: snapshot.events.length,
    }).toEqual({ version: 2, balance: 1500, eventCount: 2 });
  });

  it("builds state from a snapshot plus new events", () => {
    const snapshot: AccountSnapshot = {
      version: 2,
      balance: 1500,
      events: [
        { type: "ACCOUNT_OPENED", payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 } },
        { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      ],
    };

    const restored = restoreFromSnapshot(snapshot, {
      newEvents: [{ type: "MONEY_WITHDRAWN", payload: { amount: 200, at: 2 } }],
    });
    expect({
      balance: restored.balance,
      version: restored.version,
      eventCount: restored.events.length,
    }).toEqual({ balance: 1300, version: 3, eventCount: 3 });
  });
});

describe("event sourcing — balance projection (read model)", () => {
  it("keeps the projection balance in sync with forwarded events", () => {
    const { actor } = createAccountAggregate();
    const projection = createBalanceProjection();

    function forwardLatestEvent() {
      const latest = actor.context.events[actor.context.events.length - 1];
      if (latest) {
        projection.actor.send(eventStoredEvt.create({ event: latest }));
      }
    }

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    forwardLatestEvent();
    expect({ balance: projection.actor.context.balance }).toEqual({ balance: 1000 });

    actor.send(depositCmd.create({ amount: 500 }));
    forwardLatestEvent();
    expect({ balance: projection.actor.context.balance }).toEqual({ balance: 1500 });

    actor.send(withdrawCmd.create({ amount: 200 }));
    forwardLatestEvent();
    expect({ balance: projection.actor.context.balance }).toEqual({ balance: 1300 });
  });

  it("builds the projection from the event log during replay", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));
    actor.send(withdrawCmd.create({ amount: 200 }));

    const projection = createBalanceProjection();
    for (const domainEvent of actor.context.events) {
      projection.actor.send(eventStoredEvt.create({ event: domainEvent }));
    }

    expect({
      balance: projection.actor.context.balance,
      lastVersion: projection.actor.context.lastVersion,
    }).toEqual({ balance: 1300, lastVersion: 3 });
  });

  it("updates the projection version with each stored event", () => {
    const projection = createBalanceProjection();

    projection.actor.send(
      eventStoredEvt.create({
        event: {
          type: "ACCOUNT_OPENED",
          payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 },
        },
      }),
    );

    projection.actor.send(
      eventStoredEvt.create({
        event: { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      }),
    );
    expect({ lastVersion: projection.actor.context.lastVersion }).toEqual({ lastVersion: 2 });
  });
});

describe("event sourcing — time travel debugging", () => {
  it("returns intermediate balances when replaying to version N", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));
    actor.send(withdrawCmd.create({ amount: 200 }));
    actor.send(depositCmd.create({ amount: 100 }));

    const events = actor.context.events;

    const balances = [1, 2, 3, 4].map(
      (target) => foldEventsToVersion(events, { version: target }).balance,
    );
    expect(balances).toEqual([1000, 1500, 1300, 1400]);
  });

  it("keeps event timestamps for debugging", () => {
    const { actor, clock } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    clock.advance(100);
    actor.send(depositCmd.create({ amount: 500 }));
    clock.advance(200);
    actor.send(withdrawCmd.create({ amount: 200 }));

    const events = actor.context.events;
    const [openedEvent] = events;

    expect({
      timestamps: events.map((domainEvent) => domainEvent.payload.at),
      accountId: openedEvent?.type === "ACCOUNT_OPENED" ? openedEvent.payload.accountId : undefined,
    }).toEqual({ timestamps: [0, 100, 300], accountId: "ACC-001" });
  });
});
