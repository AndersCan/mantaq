# Mantaq - Vision

## What it is

Mantaq is a **100% type-safe, testable state library**. It models logic as
actor-model state machines (states, events, context, effects, composition) so
behavior is deterministic and provable, not hidden in ad-hoc code.

## Who it is for

Anyone who needs to understand how a machine behaves. A diagram of states and
transitions is faster to read than thousands of lines of code. "Developer" means
anyone technically building.

## Invariants (not ranked)

Not trade-offs. Nothing is traded against them.

- **Type safety.** No casts, no type errors. Type flow carries from event to
  state to effect, end to end.
- **Determinism.** Same inputs, same trace. The runtime reads no wall clock,
  randomness, or env. Time comes from an injected clock.

Core promise: _If it typechecks, it runs correct; if it runs, it runs
deterministically; if tests pass, the behavior is proven._

## Decision principles

Ranked for trade-offs, highest first. Use these when reviewing a design.

1. **One way.** Each behavior has one path. When two ways express the same
   thing, keep one.
   - _When one way conflicts with ergonomics, one way wins._ Sugar offers the
     same path, never a second one.
   - Example: declarative guards are out. Guard logic lives inside opaque handler
     functions (glossary: Guard).

2. **Small core.** Core is primitives only: states and events, context, effects,
   regions, clock. Source: `packages/core/vision.md`.
   - _When a feature conflicts with small core, it goes to a recipe or sugar.
     Core grows only when no composition covers it._ Budgets are enforced by
     `vp run guard`.
   - Example: `StateRef.regions()` (#241) was a dead API. It was removed, not
     wired up into a bigger core.
   - _When visualizer power conflicts with small core, core does not grow for
     the visualizer. The visualizer adapts to core._ Core changes only when the
     diagram cannot be faithful without them (remedy, #286), and each change is
     justified by that need.
   - Visualizer code lives in dev-time tooling. The deployed bundle carries none
     of it.

3. **Ergonomics.** Sugar only, and only when types and one-way hold. Sugar wraps
   core, never adds behavior core lacks, never weakens types.
   - _When an ergonomic API would weaken type flow, we keep the types and accept
     the verbosity._
   - Example: `withTimeout(ms, input, event)` wraps `clock.setTimeout`; it adds
     no new behavior.

## Modular review

Machines are reviewed in modules. A reviewer confirms states from the diagram,
then checks each effect on its own. Review never requires loading the whole
machine.

- Effects are reviewed by the before and after of the context they work on. The
  diagram shows that diff. Effects declare no reads or writes.
- _When a design needs hidden shared context to understand a state or effect,
  restructure it to be explicit and local._

## The visualizer

Part of the core promise: behavior is readable without reading code.

- The diagram reflects the real machine, never a guess. Anything it cannot show
  is marked "undetermined" or fixed in core (remedy, #286).
- How the diagram is extracted (runtime trace of the real `Actor` vs static AST
  parse) is open. A separate plan decides it. This document does not.

## Verifying LLM-built machines

Verification is by humans reviewing the diagram, not by reading code. The type
checker, the deterministic trace, and tests cover what they can. The reviewer
confirms states and transitions from the diagram, then checks each effect
against its before/after context.

## Direction of travel / success

- A minimal, refined primitive set (core + sugar) that composes to solve common
  patterns without scope creep.
- Deterministic runtime (injectable clock, no wall-clock/random/env reads) and a
  first-class testing story (virtual clock, coverage, assertions).
- Small, stable surface; complexity stays in trivial implementations.
- Success = justus's logic is expressed almost entirely in Mantaq with proven,
  mutation-tested behavior, demonstrating the library in production.

## Relationship to the others

- **Foundation for justus.** (Almost) all of justus's logic is written in
  Mantaq; justus is the proof that Mantaq works in a real app.
- **Used internally by Ekrooh** for its connection state machine.
- Mantaq and Ekrooh are the two foundations; **justus is the proof that Mantaq
  works.** Work here is prioritized where it strengthens justus's testability
  story.

## What we will not do

**We trust the type system.** A user lying about types (hand-building a value
that claims a type it does not have) is incorrect usage of Mantaq and out of
scope. We do not add machinery to make lying safe.

- **Lying about types is out of scope.** If a value was not produced by Mantaq's
  constructors but asserts an event/state shape, `is()` narrowing it anyway is
  not a library bug.
- **Trivial runtime checks are fine.** A cheap guard on visible data (e.g.
  checking `type` or payload fields) is welcome. Hidden state added only to make
  guards bulletproof against liars is not.
- **Brands are allowed.** Type-level brands mark values as safe (e.g. a string
  validated for a function that requires it). Runtime symbol brands are allowed
  when they are the only sound way to keep a type guard honest: `event()` mints
  a per-type symbol that `create()` stamps and `is()` checks (#264). Beyond the
  brand itself, no hidden state: no per-instance registries or non-enumerable
  stamps. Guards must be justified by the value's observable shape.
- **No invisible state.** Two values that are `toEqual`, serialize identically,
  and spread identically must behave identically.
- **No declarative guards.** Handlers stay opaque functions.
- **No history states.** Core does not support them (#283).
- **No runtime behavior that exists only in the visualizer or tests.** The diagram
  and the tests describe the real `Actor`, never a second implementation.
- **Fixes must shrink, not grow.** A "fix" that adds a registry, caching, or new
  invariants to defend against a scenario the types already prevent is rejected,
  however principled it sounds.
