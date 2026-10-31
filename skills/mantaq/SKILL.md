---
name: mantaq
description: Create and use actor-model state machines with @mantaq/core in your own project. Philosophy, mental model, conventions. Read sibling files (sugar.md, patterns.md, testing.md, reviewing.md) when the task touches those areas.
allowed-tools: Read Grep Glob Edit Write Shell
---

# Mantaq Skill

Actor-model state machine library for TypeScript. `npm install @mantaq/core`. Minimal primitives: states + events, context, effects, regions, one injectable clock.

**Written against:** `@mantaq/core` 0.4, `@mantaq/sugar` 1.0, `@mantaq/test` 1.0, `@mantaq/traversal` 0.2.

## Trust the installed package over this skill

This skill teaches the mental model and conventions. It does not list exact
signatures, defaults or option names, and what it does state can go stale.

Before writing code:

1. Read the installed versions from `node_modules/@mantaq/*/package.json`. If they differ from "Written against", treat this skill as a guide only.
2. Take every signature from the installed type declarations (`node_modules/@mantaq/core/dist/*.d.ts`) and from the repo's `packages/examples/` tests when available. They are checked by the compiler. Prose is not.
3. If the types and this skill disagree, the types win. Say so to the user.

If code fails to typecheck, fix it against the types. Never silence the
compiler with `as any`, `as unknown as` or `@ts-ignore`.

## Philosophy

Three machine checks:

- **If it typechecks, it runs correct.** Type = behavior.
- **If it runs, it runs deterministic.** Same inputs, same trace. One injectable clock.
- **If tests pass, behavior is proven.** Virtual clock, mutation-tested.

One way to do things; don't invent competing patterns.

## Mental Model

- **State.** A named node, created with `state("name")<Payload>()`, final with `.final()`. States model the domain. Not booleans in context.
- **Event.** A named message, `event("NAME")<Payload>()`. Build instances with `.create()`, never by hand.
- **Context.** Plain, cloneable shared data that accumulates across transitions. Not a substitute for states. `context.set()` is the write signal for subscribers.
- **State payload.** Data tied to one visit to a state, passed on transition. Per-visit data → payload. Cross-step data → context.
- **Effect.** A named side effect that runs when a state is entered and is aborted when it is left. All async work, timers and I/O live here. Never in transition handlers.
- **Transition handler.** Pure decision: read event + context, return the next state and/or events to emit. Registered per state (`m.on`) or for every state (`m.onAny`).
- **Clock.** The only source of time. `VirtualClock` in tests, `RealClock` in production.
- **Regions.** Child actors composed into a parent. Forwarding events into a child is manual.
- **Actor.** Wires the above together: declared `inputs` (what callers send), `internal` events (emitted back to itself), `outputs` (emitted outward), states, initial state, context, clock, and a `setup` that registers handlers and effects.

Everything runs synchronously in one call stack with `VirtualClock`. No awaits needed for timer work in tests.

## Designing a Machine

Design before code, in this order:

1. **States first.** List every state the system can be in. If the user hasn't said, read the existing code or ask questions to understand the app, then propose the states and get agreement. Mark which are final. Failures that are part of the domain (declined, timed out) are states too.
2. **Then edges.** For each state, which events move it where? Name the events and say which are inputs (from callers) and which are internal (emitted by effects). Draw the whole graph before writing handlers.
3. **Then effects.** For each state, ask what must happen on entry: calls, timers, logging, I/O. Effects run on entry to a state, not on an edge. "When going A→B, send a log" is an effect on B. If it must only fire when coming from A, model a separate state, or carry the source in context or state payload.
4. **Decisions are transitions, not effects.** "Validate, then go to B or C" is a handler returning B or C. If validation is async, the effect does the work and emits an internal event, and a handler on that event picks B or C.
5. **Then context.** Add data only for what states and events can't carry.

Rule of thumb: a question about _where we go_ belongs in a transition; a question about _what we do_ belongs in an effect.

## Rules

- All timing through the injected clock. No real timers, `Date.now` or `Math.random` in effects.
- Effects check `signal.aborted` before emitting, and hand the abort signal to any timer they create.
- Declare payload types at boundaries. Bare `state("x")()` has payload `unknown`.
- Declare every event an actor emits (`internal` / `outputs`), and handle each internal event in every state that can receive it.
- Final states ignore all events.
- Domain failures (declined card, timeout) are states and events: recoverable → non-final state with retry, terminal → final state. Never booleans in context.
- Handlers and effects should not throw for expected failures. A throw sends the actor to a terminal error state (`snapshot().error`, `on("error")`). Treat that as a bug signal, not control flow.
- `actor.state` inside a state handler is the previous state. Prefer branching on event payload or context.
- Test with `VirtualClock` and the `@mantaq/test` harness. See `testing.md`.

## Sibling Files

- `sugar.md`. Sugar helpers: what exists and when to use each
- `patterns.md`. Recipes: async effects, retries, regions, event sourcing
- `testing.md`. Virtual clock, `@mantaq/test`, coverage
- `reviewing.md`. Review your actor code against mantaq conventions
