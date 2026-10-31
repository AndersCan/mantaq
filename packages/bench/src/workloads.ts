import { Actor, VirtualClock, event } from "@mantaq/core";
import { events, states } from "@mantaq/sugar";

const counterStates = states("on", "off");
const counterEvents = events("TICK", "TOGGLE");
const damage = event("DAMAGE")<{ amount: number }>();

function toggler() {
  return Actor({
    inputs: [counterEvents.TOGGLE],
    outputs: [],
    internal: [],
    states: [counterStates.on, counterStates.off],
    initial: counterStates.on,
    context: {},
    setup: (machine) => {
      machine.on(counterStates.on, {
        event: counterEvents.TOGGLE,
        to: [counterStates.off],
        handler: () => ({ state: counterStates.off }),
      });
      machine.on(counterStates.off, {
        event: counterEvents.TOGGLE,
        to: [counterStates.on],
        handler: () => ({ state: counterStates.on }),
      });
    },
  });
}

/** Single state, one handler, no context: raw dispatch cost. */
export function dispatchWorkload() {
  const actor = Actor({
    inputs: [counterEvents.TICK],
    outputs: [],
    internal: [],
    states: [counterStates.on],
    initial: counterStates.on,
    context: {},
    setup: (machine) => {
      machine.on(counterStates.on, { event: counterEvents.TICK, handler: () => ({}) });
    },
  });
  return () => {
    actor.send(counterEvents.TICK.create());
  };
}

/** Two states with a real transition each send. */
export function transitionWorkload() {
  const actor = toggler();
  return () => {
    actor.send(counterEvents.TOGGLE.create());
  };
}

/** Game-loop representative: guard + context read/write per event. */
export function contextGuardWorkload() {
  const actor = Actor({
    inputs: [damage],
    outputs: [],
    internal: [],
    states: [counterStates.on],
    initial: counterStates.on,
    context: { health: 100 },
    setup: (machine) => {
      machine.on(counterStates.on, {
        event: damage,
        handler: (incoming, { context }) => {
          const current = context.get();
          if (current.health <= 0) return {};
          current.health = current.health - incoming.payload.amount;
          if (current.health <= 0) current.health = 100;
          context.set(current);
          return {};
        },
      });
    },
  });
  return () => {
    actor.send(damage.create({ amount: 1 }));
  };
}

/** Parent forwards each event to a child region: fan-out cost. */
export function regionWorkload() {
  const actor = Actor({
    inputs: [counterEvents.TOGGLE],
    outputs: [],
    internal: [],
    states: [counterStates.on],
    initial: counterStates.on,
    context: {},
    regions: { child: toggler() },
    setup: (machine) => {
      machine.on(counterStates.on, {
        event: counterEvents.TOGGLE,
        handler: () => {
          actor.regions.child.send(counterEvents.TOGGLE.create());
          return {};
        },
      });
    },
  });
  return () => {
    actor.send(counterEvents.TOGGLE.create());
  };
}

/** Virtual clock: schedule + fire a timer, the cost of time-driven machines. */
export function clockWorkload() {
  const clock = VirtualClock();
  return () => {
    clock.setTimeout(1, { cb: () => {} });
    clock.advance(1);
  };
}
