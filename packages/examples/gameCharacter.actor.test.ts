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
 *   - No declarative guard syntax (e.g., `when(state, event, guard, handler)`)
 *   - Context type assertions needed everywhere
 *   - Region-to-region communication requires knowing actor instances
 *   - Effects tied to parent states, not region states — can't react to region changes
 *   - No shorthand for common guard patterns
 */

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, event } from "@mantaq/core";
import type { EffectInput } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";

// ── States ───────────────────────────────────────────────────────────

const s = states("alive", "dead", "idle", "running", "sprinting");
const lifeStates = { alive: s.alive, dead: s.dead.final() };
const movementStates = { idle: s.idle, running: s.running, sprinting: s.sprinting };

// Combat is tracked in context, not as separate region
// (because effects are tied to parent states, not region states)

// ── Events ───────────────────────────────────────────────────────────

const takeDamageEvent = event("TAKE_DAMAGE")<{ amount: number }>();
const e = events("START_SPRINT", "STOP_SPRINT", "ATTACK", "REGEN");

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
  const c = clock ?? new VirtualClock();

  // Movement region
  const movementRegion = new Actor({
    inputs: [e.START_SPRINT, e.STOP_SPRINT],
    outputs: [],
    internal: [],
    states: [movementStates.idle, movementStates.running, movementStates.sprinting],
    initial: movementStates.idle,
    context: {} as {},
    setup: (m) => {
      m.on(movementStates.idle, e.START_SPRINT, () => ({ state: movementStates.sprinting }));
      m.on(movementStates.running, e.START_SPRINT, () => ({ state: movementStates.sprinting }));
      m.on(movementStates.sprinting, e.STOP_SPRINT, () => ({ state: movementStates.running }));
    },
  });

  // Main character actor — combat state tracked in context
  const actor = new Actor({
    inputs: [e.START_SPRINT, e.STOP_SPRINT, e.ATTACK, takeDamageEvent, e.REGEN],
    outputs: [],
    internal: [e.REGEN],
    states: [lifeStates.alive, lifeStates.dead],
    initial: lifeStates.alive,
    clock: c,
    context: {
      health: 100,
      maxHealth: 100,
      stamina: 100,
      maxStamina: 100,
      attackDamage: 25,
      attackCooldownMs: 1500,
      staminaRegenRate: 10,
      healthRegenRate: 5,
      combatState: "idle",
    } as CharacterContext,
    regions: {
      movement: movementRegion,
    },
    setup: (m) => {
      m.effect(lifeStates.alive, ({ signal, clock, emit }: EffectInput<CharacterContext>) => {
        const id = clock.setInterval(500, () => {
          emit(e.REGEN.create(undefined));
        });
        signal.addEventListener("abort", () => clock.clearInterval(id));
      });
      m.on(lifeStates.alive, e.START_SPRINT, (_event, opts) => {
        const context = opts!.context;
        if (context.stamina <= 0) return {};
        context.stamina = Math.max(0, context.stamina - 20);
        actor.regions.movement.send(e.START_SPRINT.create());
        return {};
      });
      m.on(lifeStates.alive, e.STOP_SPRINT, () => {
        actor.regions.movement.send(e.STOP_SPRINT.create());
        return {};
      });
      m.on(lifeStates.alive, e.ATTACK, (_event, opts) => {
        const context = opts!.context;
        if (context.health <= 0) return {};
        if (context.combatState !== "idle") return {};
        context.combatState = "attacking";
        c.setTimeout(500, () => {
          context.combatState = "cooldown";
          c.setTimeout(context.attackCooldownMs, () => {
            context.combatState = "idle";
          });
        });
        return {};
      });
      m.onAny(takeDamageEvent, (event, opts) => {
        const context = opts!.context;
        context.health = Math.max(0, context.health - event.amount);
        if (context.health <= 0) {
          context.combatState = "idle";
          return { state: lifeStates.dead };
        }
        return {};
      });
      m.onAny(e.REGEN, (_event, opts) => {
        const context = opts!.context;
        context.stamina = Math.min(context.maxStamina, context.stamina + context.staminaRegenRate);
        context.health = Math.min(context.maxHealth, context.health + context.healthRegenRate);
        return {};
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("game character actor", () => {
  it("starts alive with full health and stamina", () => {
    const { actor } = createCharacter();
    expect(matches(actor, "alive")).toBe(true);
    expect(actor.context.health).toBe(100);
    expect(actor.context.stamina).toBe(100);
  });

  it("starts in idle movement and idle combat", () => {
    const { actor } = createCharacter();
    expect(matches(actor, "alive.movement.idle")).toBe(true);
    expect(actor.context.combatState).toBe("idle");
  });

  it("TAKE_DAMAGE reduces health", () => {
    const { actor } = createCharacter();
    actor.send(takeDamageEvent.create({ amount: 30 }));
    expect(actor.context.health).toBe(70);
    expect(matches(actor, "alive")).toBe(true);
  });

  it("TAKE_DAMAGE to 0 → dead", () => {
    const { actor } = createCharacter();
    actor.send(takeDamageEvent.create({ amount: 100 }));
    expect(actor.context.health).toBe(0);
    expect(matches(actor, "dead")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
  });

  it("sprint consumes stamina", () => {
    const { actor } = createCharacter();
    actor.send(e.START_SPRINT.create());
    expect(actor.context.stamina).toBe(80);
    expect(matches(actor, "alive.movement.sprinting")).toBe(true);
  });

  it("cannot sprint with 0 stamina", () => {
    const { actor } = createCharacter();
    (actor.context as CharacterContext).stamina = 0;
    actor.send(e.START_SPRINT.create());
    expect(matches(actor, "alive.movement.idle")).toBe(true);
  });

  it("attack transitions to attacking state", () => {
    const { actor } = createCharacter();
    actor.send(e.ATTACK.create());
    expect(actor.context.combatState).toBe("attacking");
  });

  it("cannot attack while already attacking", () => {
    const { actor } = createCharacter();
    actor.send(e.ATTACK.create());
    expect(actor.context.combatState).toBe("attacking");

    // Second attack ignored (guard: combatState !== "idle")
    actor.send(e.ATTACK.create());
    expect(actor.context.combatState).toBe("attacking");
  });

  it("attack → cooldown → idle cycle", () => {
    const { actor, clock } = createCharacter();

    actor.send(e.ATTACK.create());
    expect(actor.context.combatState).toBe("attacking");

    clock.advance(500); // attack duration
    expect(actor.context.combatState).toBe("cooldown");

    clock.advance(1500); // cooldown
    expect(actor.context.combatState).toBe("idle");
  });

  it("REGEN event restores stamina and health", () => {
    const { actor } = createCharacter();
    (actor.context as CharacterContext).stamina = 50;
    (actor.context as CharacterContext).health = 80;

    actor.send(e.REGEN.create());
    expect(actor.context.stamina).toBe(60);
    expect(actor.context.health).toBe(85);
  });

  it("sprint stop returns to running", () => {
    const { actor } = createCharacter();

    actor.send(e.START_SPRINT.create());
    expect(matches(actor, "alive.movement.sprinting")).toBe(true);

    actor.send(e.STOP_SPRINT.create());
    expect(matches(actor, "alive.movement.running")).toBe(true);
  });

  it("regions are independent: sprinting + attacking", () => {
    const { actor } = createCharacter();

    actor.send(e.START_SPRINT.create());
    actor.send(e.ATTACK.create());

    expect(matches(actor, "alive.movement.sprinting")).toBe(true);
    expect(actor.context.combatState).toBe("attacking");
  });

  // ── DX Pain Points ────────────────────────────────────────────────
  it("DX: effects don't run on initial state — only on transitions", () => {
    // Effects only run via #runEffects which is called in #applyTransition.
    // The constructor sets state but never calls #runEffects.
    // For periodic effects (like stamina regen), you must either:
    // 1. Start in a different state and transition to the "active" state
    // 2. Use clock.setInterval outside the actor (breaks encapsulation)
    //
    // In xstate, `invoke: fromCallback` runs on state entry including initial.
    const { actor } = createCharacter();
    expect(matches(actor, "alive")).toBe(true);
  });

  it("DX: guard conditions are verbose manual checks", () => {
    const { actor } = createCharacter();

    // Sprint guard requires:
    // 1. Cast context to correct type
    // 2. Manual stamina check
    // 3. Return {} to prevent transition if guard fails
    // No declarative guard like: when(alive, startSprint, hasStamina, handler)
    (actor.context as CharacterContext).stamina = 0;
    actor.send(e.START_SPRINT.create());
    expect(matches(actor, "alive.movement.idle")).toBe(true);

    // Without explicit guard, would need:
    // if ((actor.context as CharacterContext).stamina <= 0) return {};
    // This is error-prone: easy to forget, easy to get type wrong
  });

  it("DX: context type assertions needed everywhere", () => {
    const { actor } = createCharacter();

    // Every transition handler needs: const ctx = context as CharacterContext
    // No type narrowing from state, no typed context per state
    // The type assertion is repeated in every handler (~10 times in this example)
    actor.send(takeDamageEvent.create({ amount: 50 }));
    expect((actor.context as CharacterContext).health).toBe(50);
  });

  it("DX: region communication requires knowing actor key strings", () => {
    const { actor } = createCharacter();

    // Must use exact string keys: actor.regions.movement
    // No compile-time check that region exists
    // Typo: actor.regions.movment → runtime undefined, no error
    actor.regions.movement.send(e.START_SPRINT.create());
    expect(matches(actor, "alive.movement.sprinting")).toBe(true);

    // DX: regions is Record<string, AnyActor> — no type safety
  });

  it("DX: effects can't react to region state changes", () => {
    // Effects are keyed by parent state name, not region state.
    // If you want an effect to fire when a region enters a state,
    // you must handle it via events: region emits → parent receives → parent handles.
    // No declarative: `onRegionEnter(combat.attacking, handler)`
    const { actor, clock } = createCharacter();

    actor.send(e.START_SPRINT.create());
    actor.send(e.ATTACK.create());

    // The attack timer is set up via clock.setTimeout in the ATTACK handler,
    // not via an effect on the combat region. This works but:
    // - Timer isn't auto-aborted if character dies during attack
    // - Timer isn't auto-aborted if we add more combat states
    // - Manual timer management in transitions = more boilerplate
    clock.advance(500);
    expect(actor.context.combatState).toBe("cooldown");
  });
});
