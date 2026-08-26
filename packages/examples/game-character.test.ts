/**
 * Problem: Game character state machine with health, stamina, combat,
 * and movement. Multiple overlapping concerns: can't attack while dead,
 * can't sprint while attacking, stamina regenerates while idle, etc.
 * Classic boolean-soup: isAlive, canAttack, isSprinting, hasStamina, etc.
 *
 * Actor model approach:
 *   - Character: states for alive/dead
 *   - Region: movement (idle/running/sprinting) — concurrent with top-level
 *   - Context: health, stamina, combat state
 *   - Guard conditions: stamina > 0 for sprint, health > 0 for actions
 *   - Effects: attack timer, cooldown timer (on parent states)
 *
 * DX Pain Points Exposed:
 *   - Guard conditions require manual state + context checks in transitions
 *   - No declarative guard syntax like when(state, event, guard, handler)
 *   - Context type assertions needed everywhere
 *   - Region-to-region communication requires knowing actor instances
 *   - Effects tied to parent states, not region states — can't react to region changes
 *   - No shorthand for common guard patterns
 */

import { Actor, VirtualClock, event } from "@mantaq/core";
import type { EffectInput } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

// ── States ───────────────────────────────────────────────────────────

const characterStates = states("alive", "dead", "idle", "running", "sprinting");
const lifeStates = {
  alive: characterStates.alive,
  dead: characterStates.dead.final(),
};
const movementStates = {
  idle: characterStates.idle,
  running: characterStates.running,
  sprinting: characterStates.sprinting,
};

/**
 * Combat is tracked in context, not as separate region
 * (because effects are tied to parent states, not region states)
 */

// ── Events ───────────────────────────────────────────────────────────

const takeDamageEvent = event("TAKE_DAMAGE")<{ amount: number }>();
const combatEvents = events("START_SPRINT", "STOP_SPRINT", "ATTACK", "REGEN");

// ── Context ──────────────────────────────────────────────────────────

type CombatState = "idle" | "attacking" | "cooldown";

type CharacterContext = {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  attackDamage: number;
  attackCooldownMs: number;
  staminaRegenRate: number;
  healthRegenRate: number;
  combatState: CombatState;
};

// ── Actor Factory ────────────────────────────────────────────────────

function createCharacter(clock?: VirtualClock) {
  const c = clock ?? VirtualClock();

  // Movement region
  const movementRegion = Actor({
    inputs: [combatEvents.START_SPRINT, combatEvents.STOP_SPRINT],
    outputs: [],
    internal: [],
    states: [movementStates.idle, movementStates.running, movementStates.sprinting],
    initial: movementStates.idle,
    context: {},
    setup: (m) => {
      m.on(movementStates.idle, {
        eventRef: combatEvents.START_SPRINT,
        handler: () => ({
          state: movementStates.sprinting,
        }),
      });
      m.on(movementStates.running, {
        eventRef: combatEvents.START_SPRINT,
        handler: () => ({
          state: movementStates.sprinting,
        }),
      });
      m.on(movementStates.sprinting, {
        eventRef: combatEvents.STOP_SPRINT,
        handler: () => ({
          state: movementStates.running,
        }),
      });
    },
  });

  const initialContext: CharacterContext = {
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    attackDamage: 25,
    attackCooldownMs: 1500,
    staminaRegenRate: 10,
    healthRegenRate: 5,
    combatState: "idle",
  };

  // Main character actor — combat state tracked in context
  const actor = Actor({
    inputs: [
      combatEvents.START_SPRINT,
      combatEvents.STOP_SPRINT,
      combatEvents.ATTACK,
      takeDamageEvent,
      combatEvents.REGEN,
    ],
    outputs: [],
    internal: [combatEvents.REGEN],
    states: [lifeStates.alive, lifeStates.dead],
    initial: lifeStates.alive,
    clock: c,
    context: initialContext,
    regions: {
      movement: movementRegion,
    },
    setup: (m) => {
      m.effect(lifeStates.alive, {
        name: "regenHealthAndStamina",
        fn: ({ signal, clock, emit }: EffectInput<CharacterContext>) => {
          const intervalId = clock.setInterval(500, {
            cb: () => {
              emit(combatEvents.REGEN.create(undefined));
            },
          });
          signal.addEventListener("abort", () => clock.clearInterval(intervalId));
        },
      });
      m.on(lifeStates.alive, {
        eventRef: combatEvents.START_SPRINT,
        handler: (_event, { context }) => {
          const current = context.get();
          if (current.stamina <= 0) return {};
          current.stamina = Math.max(0, current.stamina - 20);
          context.set(current);
          actor.regions.movement.send(combatEvents.START_SPRINT.create());
          return {};
        },
      });
      m.on(lifeStates.alive, {
        eventRef: combatEvents.STOP_SPRINT,
        handler: () => {
          actor.regions.movement.send(combatEvents.STOP_SPRINT.create());
          return {};
        },
      });
      m.on(lifeStates.alive, {
        eventRef: combatEvents.ATTACK,
        handler: (_event, { context }) => {
          const current = context.get();
          if (current.health <= 0) return {};
          if (current.combatState !== "idle") return {};
          current.combatState = "attacking";
          context.set(current);
          c.setTimeout(500, {
            cb: () => {
              const updated = context.get();
              updated.combatState = "cooldown";
              context.set(updated);
              c.setTimeout(updated.attackCooldownMs, {
                cb: () => {
                  const settled = context.get();
                  settled.combatState = "idle";
                  context.set(settled);
                },
              });
            },
          });
          return {};
        },
      });
      m.onAny({
        eventRef: takeDamageEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.health = Math.max(0, current.health - event.payload.amount);
          if (current.health <= 0) {
            current.combatState = "idle";
            context.set(current);
            return { state: lifeStates.dead };
          }
          context.set(current);
          return {};
        },
      });
      m.onAny({
        eventRef: combatEvents.REGEN,
        handler: (_event, { context }) => {
          const current = context.get();
          current.stamina = Math.min(
            current.maxStamina,
            current.stamina + current.staminaRegenRate,
          );
          current.health = Math.min(current.maxHealth, current.health + current.healthRegenRate);
          context.set(current);
          return {};
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("game character actor", () => {
  it("sets full health and stamina while alive", () => {
    const { actor } = createCharacter();
    expect({
      matches: matches(actor, "alive"),
      health: actor.context.health,
      stamina: actor.context.stamina,
    }).toEqual({ matches: true, health: 100, stamina: 100 });
  });

  it("sets idle movement and idle combat initially", () => {
    const { actor } = createCharacter();
    expect(matches(actor, "alive.movement.idle")).toBe(true);
    expect(actor.context.combatState).toBe("idle");
  });

  it("updates health downward when TAKE_DAMAGE fires", () => {
    const { actor } = createCharacter();
    actor.send(takeDamageEvent.create({ amount: 30 }));
    expect({ health: actor.context.health, matches: matches(actor, "alive") }).toEqual({
      health: 70,
      matches: true,
    });
  });

  it("sets dead when TAKE_DAMAGE drops health to 0", () => {
    const { actor } = createCharacter();
    actor.send(takeDamageEvent.create({ amount: 100 }));
    expect({
      health: actor.context.health,
      matches: matches(actor, "dead"),
      done: actor.snapshot().done,
    }).toEqual({ health: 0, matches: true, done: true });
  });

  it("removes stamina when sprinting", () => {
    const { actor } = createCharacter();
    actor.send(combatEvents.START_SPRINT.create());
    expect({
      stamina: actor.context.stamina,
      matches: matches(actor, "alive.movement.sprinting"),
    }).toEqual({ stamina: 80, matches: true });
  });

  it("ignores START_SPRINT with 0 stamina", () => {
    const { actor } = createCharacter();
    actor.context.stamina = 0;
    actor.send(combatEvents.START_SPRINT.create());
    expect(matches(actor, "alive.movement.idle")).toBe(true);
  });

  it("sets attacking when ATTACK fires", () => {
    const { actor } = createCharacter();
    actor.send(combatEvents.ATTACK.create());
    expect(actor.context.combatState).toBe("attacking");
  });

  it("ignores ATTACK while already attacking", () => {
    const { actor } = createCharacter();
    actor.send(combatEvents.ATTACK.create());

    // Second attack ignored (guard: combatState !== "idle")
    actor.send(combatEvents.ATTACK.create());
    expect({ combatState: actor.context.combatState }).toEqual({ combatState: "attacking" });
  });

  it("sets combatState through attack, cooldown, then idle over time", () => {
    const { actor, clock } = createCharacter();

    actor.send(combatEvents.ATTACK.create());
    expect({ combatState: actor.context.combatState }).toEqual({ combatState: "attacking" });

    clock.advance(500); // attack duration
    expect({ combatState: actor.context.combatState }).toEqual({ combatState: "cooldown" });

    clock.advance(1500); // cooldown
    expect({ combatState: actor.context.combatState }).toEqual({ combatState: "idle" });
  });

  it("adds stamina and health back on REGEN", () => {
    const { actor } = createCharacter();
    actor.context.stamina = 50;
    actor.context.health = 80;

    actor.send(combatEvents.REGEN.create());
    expect({ stamina: actor.context.stamina, health: actor.context.health }).toEqual({
      stamina: 60,
      health: 85,
    });
  });

  it("returns to running after stopping a sprint", () => {
    const { actor } = createCharacter();

    actor.send(combatEvents.START_SPRINT.create());
    expect(matches(actor, "alive.movement.sprinting")).toBe(true);

    actor.send(combatEvents.STOP_SPRINT.create());
    expect(matches(actor, "alive.movement.running")).toBe(true);
  });

  it("keeps regions independent: sprinting plus attacking", () => {
    const { actor } = createCharacter();

    actor.send(combatEvents.START_SPRINT.create());
    actor.send(combatEvents.ATTACK.create());

    expect({
      matches: matches(actor, "alive.movement.sprinting"),
      combatState: actor.context.combatState,
    }).toEqual({ matches: true, combatState: "attacking" });
  });

  // ── DX Pain Points ────────────────────────────────────────────────
  it("keeps effects from running on the initial state", () => {
    /**
     * Effects only run via #runEffects which is called in #applyTransition.
     * The constructor sets state but never calls #runEffects.
     * For periodic effects (like stamina regen), you must either:
     * 1. Start in a different state and transition to the "active" state
     * 2. Use clock.setInterval outside the actor (breaks encapsulation)
     *
     * In xstate, invoke-fromCallback runs on state entry including initial.
     */
    const { actor } = createCharacter();
    expect(matches(actor, "alive")).toBe(true);
  });

  it("handles guards as verbose manual checks", () => {
    const { actor } = createCharacter();

    /**
     * Sprint guard requires:
     * 1. Typed context access
     * 2. Manual stamina check
     * 3. An empty object result to prevent the transition when the guard fails
     * No declarative guard helper exists for this
     */
    actor.context.stamina = 0;
    actor.send(combatEvents.START_SPRINT.create());
    expect(matches(actor, "alive.movement.idle")).toBe(true);

    /**
     * Without an explicit guard, each handler would need a manual early exit,
     * which is error-prone: easy to forget, easy to get the type wrong
     */
  });

  it("updates health after damage without type assertions", () => {
    const { actor } = createCharacter();

    /**
     * Every transition handler needs: const current = context.get()
     * No type narrowing from state, no typed context per state
     * The read-modify-write is repeated in every handler (~10 times in this example)
     */
    actor.send(takeDamageEvent.create({ amount: 50 }));
    expect(actor.context.health).toBe(50);
  });

  it("sets sprinting by sending straight to the movement region", () => {
    const { actor } = createCharacter();

    /**
     * Must use exact string keys: actor.regions.movement
     * No compile-time check that region exists
     * Typo: actor.regions.movment → runtime undefined, no error
     */
    actor.regions.movement.send(combatEvents.START_SPRINT.create());
    expect(matches(actor, "alive.movement.sprinting")).toBe(true);

    // DX: regions is Record<string, AnyActor> — no type safety
  });

  it("sets cooldown through a manual timer instead of a region effect", () => {
    /**
     * Effects are keyed by parent state name, not region state.
     * If you want an effect to fire when a region enters a state,
     * you must handle it via events: region emits → parent receives → parent handles.
     * No declarative onRegionEnter(handler).
     */
    const { actor, clock } = createCharacter();

    actor.send(combatEvents.START_SPRINT.create());
    actor.send(combatEvents.ATTACK.create());

    /**
     * The attack timer is set up via clock.setTimeout in the ATTACK handler,
     * not via an effect on the combat region. This works but:
     * - Timer isn't auto-aborted if character dies during attack
     * - Timer isn't auto-aborted if we add more combat states
     * - Manual timer management in transitions = more boilerplate
     */
    clock.advance(500);
    expect(actor.context.combatState).toBe("cooldown");
  });
});
