# Mantaq - Vision

## What it is

Mantaq is a **100% type-safe, testable state library** (xstate-like in spirit).
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
