# Mantaq - Vision

## What it is

Mantaq is a **100% type-safe, testable state library**.
It models complex logic as actor-model state machines - states, events,
context, effects, and composition - so that intricate behavior becomes
deterministic and provable rather than hidden in ad-hoc code.

## Goal

Make complex application logic **type-safe and testable**. If it typechecks, it
runs correct; if it runs, it runs deterministically; if tests pass, the behavior
is proven.

## Relationship to the others

- **Foundation for justus.** (Almost) all of justus's logic is written in
  Mantaq; justus is the proof that Mantaq works in a real app.
- **Used internally by Ekrooh** for its connection state machine.
- Mantaq and Ekrooh are the two foundations; **justus is the proof that Mantaq
  works.** Work here is prioritized where it strengthens justus's testability
  story.

## Direction of travel / success

- A minimal, refined primitive set (core + sugar) that composes to solve common
  patterns without scope creep.
- Deterministic runtime (injectable clock, no wall-clock/random/env reads) and
  a first-class testing story (virtual clock, coverage, assertions).
- Small, stable surface; complexity stays in trivial implementations.
- Success = justus's logic is expressed almost entirely in Mantaq with proven,
  mutation-tested behavior - demonstrating the library in production.

## What we will not do

**We trust the type system.** A user lying about types - hand-building a value
that claims a type it does not have - is incorrect usage of Mantaq and out of
scope. We do not add machinery to make lying safe.

- **Lying about types is out of scope.** If a value was not produced by Mantaq's
  constructors but asserts an event/state shape, `is()` narrowing it anyway is
  not a library bug.
- **Trivial runtime checks are fine.** A cheap guard on visible data
  (e.g. checking `type` or payload fields) is welcome. What is not welcome:
  hidden state added only to make guards bulletproof against liars.
- **No brands, symbols, or non-enumerable stamps.** Guards must be justified by
  the value's observable shape. Never stamp secret state onto objects.
- **No invisible state.** Two values that are `toEqual`, serialize identically,
  and spread identically must behave identically.
- **Fixes must shrink, not grow.** A "fix" that adds a registry, caching, or new
  invariants to defend against a scenario the types already prevent is rejected,
  however principled it sounds.
