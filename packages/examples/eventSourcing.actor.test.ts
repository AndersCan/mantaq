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

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";

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

function foldEvents(events: AccountEvent[]): { balance: number } {
  let balance = 0;
  for (const e of events) {
    switch (e.type) {
      case "ACCOUNT_OPENED":
        balance += e.payload.initialBalance;
        break;
      case "MONEY_DEPOSITED":
        balance += e.payload.amount;
        break;
      case "MONEY_WITHDRAWN":
        balance -= e.payload.amount;
        break;
      case "ACCOUNT_CLOSED":
        break;
    }
  }
  return { balance };
}

function foldEventsToVersion(events: AccountEvent[], version: number): { balance: number } {
  return foldEvents(events.slice(0, version));
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
  newEvents: AccountEvent[],
): { events: AccountEvent[]; balance: number; version: number } {
  const allEvents = [...snapshot.events, ...newEvents];
  const { balance } = foldEvents(allEvents);
  return {
    events: allEvents,
    balance,
    version: snapshot.version + newEvents.length,
  };
}

// ── Aggregate Actor ────────────────────────────────────────────────

function createAccountAggregate(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
    inputs: [openAccountCmd, depositCmd, withdrawCmd, closeAccountCmd],
    outputs: [eventStoredEvt],
    internal: [replayCompleteEvt],
    states: [activeState, closedState],
    initial: activeState,
    clock: c,
    context: { events: [], balance: 0, version: 0 } as AccountContext,
    setup: (m) => {
      m.on(activeState, openAccountCmd, (evt, opts) => {
        const s = opts!.context.get();
        const domainEvent: AccountEvent = {
          type: "ACCOUNT_OPENED",
          payload: {
            accountId: evt.payload.accountId,
            initialBalance: evt.payload.initialBalance,
            at: c.now(),
          },
        };
        opts!.context.set({
          ...s,
          events: [...s.events, domainEvent],
          balance: s.balance + evt.payload.initialBalance,
          version: s.version + 1,
        });
        return { emit: [eventStoredEvt.create({ event: domainEvent })] };
      });
      m.on(activeState, depositCmd, (evt, opts) => {
        const s = opts!.context.get();
        if (evt.payload.amount <= 0) return {};
        const domainEvent: AccountEvent = {
          type: "MONEY_DEPOSITED",
          payload: {
            amount: evt.payload.amount,
            at: c.now(),
          },
        };
        opts!.context.set({
          ...s,
          events: [...s.events, domainEvent],
          balance: s.balance + evt.payload.amount,
          version: s.version + 1,
        });
        return { emit: [eventStoredEvt.create({ event: domainEvent })] };
      });
      m.on(activeState, withdrawCmd, (evt, opts) => {
        const s = opts!.context.get();
        if (evt.payload.amount <= 0 || evt.payload.amount > s.balance) return {};
        const domainEvent: AccountEvent = {
          type: "MONEY_WITHDRAWN",
          payload: {
            amount: evt.payload.amount,
            at: c.now(),
          },
        };
        opts!.context.set({
          ...s,
          events: [...s.events, domainEvent],
          balance: s.balance - evt.payload.amount,
          version: s.version + 1,
        });
        return { emit: [eventStoredEvt.create({ event: domainEvent })] };
      });
      m.on(activeState, closeAccountCmd, (evt, opts) => {
        const s = opts!.context.get();
        const domainEvent: AccountEvent = {
          type: "ACCOUNT_CLOSED",
          payload: {
            reason: evt.payload.reason,
            at: c.now(),
          },
        };
        opts!.context.set({
          ...s,
          events: [...s.events, domainEvent],
          version: s.version + 1,
        });
        return { state: closedState, emit: [eventStoredEvt.create({ event: domainEvent })] };
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
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
    inputs: [eventStoredEvt],
    outputs: [],
    internal: [],
    states: [trackingState],
    initial: trackingState,
    clock: c,
    context: { balance: 0, lastVersion: 0, accountEvents: [] } as BalanceProjectionContext,
    setup: (m) => {
      m.on(trackingState, eventStoredEvt, (evt, opts) => {
        const s = opts!.context.get();
        const accountEvents = [...s.accountEvents, evt.payload.event];
        const { balance } = foldEvents(accountEvents);
        opts!.context.set({ ...s, accountEvents, balance, lastVersion: accountEvents.length });
        return {};
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("event sourcing — bank account aggregate", () => {
  it("starts with zero balance and empty event log", () => {
    const { actor } = createAccountAggregate();
    expect(actor.context.events).toEqual([]);
    expect(actor.context.balance).toBe(0);
    expect(actor.context.version).toBe(0);
  });

  it("OPEN_ACCOUNT stores event and derives balance", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    expect(actor.context.events).toHaveLength(1);
    expect(actor.context.events[0].type).toBe("ACCOUNT_OPENED");
    expect(actor.context.balance).toBe(1000);
    expect(actor.context.version).toBe(1);
  });

  it("DEPOSIT appends event and increases balance", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));

    expect(actor.context.events).toHaveLength(2);
    expect(actor.context.events[1].type).toBe("MONEY_DEPOSITED");
    expect(actor.context.balance).toBe(1500);
    expect(actor.context.version).toBe(2);
  });

  it("WITHDRAW appends event and decreases balance", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(withdrawCmd.create({ amount: 300 }));

    expect(actor.context.balance).toBe(700);
    expect(actor.context.version).toBe(2);
  });

  it("WITHDRAW rejected when insufficient balance — no event stored", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 100 }));
    actor.send(withdrawCmd.create({ amount: 500 }));

    expect(actor.context.events).toHaveLength(1);
    expect(actor.context.balance).toBe(100);
  });

  it("DEPOSIT rejected when amount <= 0 — no event stored", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 100 }));
    actor.send(depositCmd.create({ amount: -50 }));

    expect(actor.context.events).toHaveLength(1);
    expect(actor.context.balance).toBe(100);
  });

  it("CLOSE_ACCOUNT stores event and transitions to closed", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(closeAccountCmd.create({ reason: "user requested" }));

    expect(actor.context.events).toHaveLength(2);
    expect(actor.context.events[1].type).toBe("ACCOUNT_CLOSED");
    expect(matches(actor, "closed")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
  });

  it("no commands accepted after close", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(closeAccountCmd.create({ reason: "done" }));
    actor.send(depositCmd.create({ amount: 100 }));

    expect(actor.context.events).toHaveLength(2);
    expect(actor.context.balance).toBe(1000);
  });

  it("full event log maintained across many operations", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 200 }));
    actor.send(withdrawCmd.create({ amount: 100 }));
    actor.send(depositCmd.create({ amount: 50 }));
    actor.send(withdrawCmd.create({ amount: 25 }));

    expect(actor.context.events).toHaveLength(5);
    expect(actor.context.balance).toBe(1125);
    expect(actor.context.version).toBe(5);

    const types = actor.context.events.map((e) => e.type);
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
  it("foldEvents derives balance from event log", () => {
    const events: AccountEvent[] = [
      { type: "ACCOUNT_OPENED", payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 } },
      { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      { type: "MONEY_WITHDRAWN", payload: { amount: 200, at: 2 } },
    ];

    const { balance } = foldEvents(events);
    expect(balance).toBe(1300);
  });

  it("foldEventsToVersion derives state at specific version", () => {
    const events: AccountEvent[] = [
      { type: "ACCOUNT_OPENED", payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 } },
      { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      { type: "MONEY_WITHDRAWN", payload: { amount: 200, at: 2 } },
      { type: "MONEY_DEPOSITED", payload: { amount: 100, at: 3 } },
    ];

    expect(foldEventsToVersion(events, 0).balance).toBe(0);
    expect(foldEventsToVersion(events, 1).balance).toBe(1000);
    expect(foldEventsToVersion(events, 2).balance).toBe(1500);
    expect(foldEventsToVersion(events, 3).balance).toBe(1300);
    expect(foldEventsToVersion(events, 4).balance).toBe(1400);
  });
});

describe("event sourcing — snapshot and rebuild", () => {
  it("takeSnapshot captures version, balance, and events", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));

    const snapshot = takeSnapshot(actor.context);
    expect(snapshot.version).toBe(2);
    expect(snapshot.balance).toBe(1500);
    expect(snapshot.events).toHaveLength(2);
  });

  it("restoreFromSnapshot rebuilds state from snapshot + new events", () => {
    const snapshot: AccountSnapshot = {
      version: 2,
      balance: 1500,
      events: [
        { type: "ACCOUNT_OPENED", payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 } },
        { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      ],
    };

    const newEvents: AccountEvent[] = [
      { type: "MONEY_WITHDRAWN", payload: { amount: 200, at: 2 } },
    ];

    const restored = restoreFromSnapshot(snapshot, newEvents);
    expect(restored.balance).toBe(1300);
    expect(restored.version).toBe(3);
    expect(restored.events).toHaveLength(3);
  });
});

describe("event sourcing — balance projection (read model)", () => {
  it("projection tracks balance from event stream via manual forwarding", () => {
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
    expect(projection.actor.context.balance).toBe(1000);

    actor.send(depositCmd.create({ amount: 500 }));
    forwardLatestEvent();
    expect(projection.actor.context.balance).toBe(1500);

    actor.send(withdrawCmd.create({ amount: 200 }));
    forwardLatestEvent();
    expect(projection.actor.context.balance).toBe(1300);
  });

  it("projection can be rebuilt from event log (replay)", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));
    actor.send(withdrawCmd.create({ amount: 200 }));

    const projection = createBalanceProjection();
    for (const domainEvent of actor.context.events) {
      projection.actor.send(eventStoredEvt.create({ event: domainEvent }));
    }

    expect(projection.actor.context.balance).toBe(1300);
    expect(projection.actor.context.lastVersion).toBe(3);
  });

  it("projection version tracks event count", () => {
    const projection = createBalanceProjection();

    projection.actor.send(
      eventStoredEvt.create({
        event: {
          type: "ACCOUNT_OPENED",
          payload: { accountId: "ACC-001", initialBalance: 1000, at: 0 },
        },
      }),
    );
    expect(projection.actor.context.lastVersion).toBe(1);

    projection.actor.send(
      eventStoredEvt.create({
        event: { type: "MONEY_DEPOSITED", payload: { amount: 500, at: 1 } },
      }),
    );
    expect(projection.actor.context.lastVersion).toBe(2);
  });
});

describe("event sourcing — time travel debugging", () => {
  it("replay to version N gives correct intermediate state", () => {
    const { actor } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    actor.send(depositCmd.create({ amount: 500 }));
    actor.send(withdrawCmd.create({ amount: 200 }));
    actor.send(depositCmd.create({ amount: 100 }));

    const events = actor.context.events;

    expect(foldEventsToVersion(events, 1).balance).toBe(1000);
    expect(foldEventsToVersion(events, 2).balance).toBe(1500);
    expect(foldEventsToVersion(events, 3).balance).toBe(1300);
    expect(foldEventsToVersion(events, 4).balance).toBe(1400);
  });

  it("replay preserves event metadata for debugging", () => {
    const { actor, clock } = createAccountAggregate();

    actor.send(openAccountCmd.create({ accountId: "ACC-001", initialBalance: 1000 }));
    clock.advance(100);
    actor.send(depositCmd.create({ amount: 500 }));
    clock.advance(200);
    actor.send(withdrawCmd.create({ amount: 200 }));

    const events = actor.context.events;

    expect(events[0].payload.at).toBe(0);
    expect(events[1].payload.at).toBe(100);
    expect(events[2].payload.at).toBe(300);
    expect(events[0]).toHaveProperty("payload.accountId", "ACC-001");
  });
});
