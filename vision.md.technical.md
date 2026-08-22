# Mantaq - Technical Vision

> Companion to `vision.md` (the concise repo briefing). This file holds the
> technical depth: primitives, runtime guarantees, package topology, and the
> testing story justus relies on. Read this when implementing, not when
> prioritizing.

## Architecture in one paragraph

Mantaq is an actor-model state-machine library for TypeScript. Behavior is built
from small primitives - States + Events, Context, Effects, Regions/Composition,
and a single injectable Clock - composed into machines. The runtime is
deterministic and side-effect-free by construction; side effects are modeled as
explicit Effects, never implicit environment reads.

## The three machine-checked claims

- **If it typechecks, it runs correct.** Types encode behavior; no stringly-typed
  dispatch. Any gap between the type level and runtime is a design bug, not a
  usage error.
- **If it runs, it runs deterministic.** The runtime never reads the wall clock,
  randomness, or environment. Time comes only from the injectable Clock, so the
  same inputs always yield the same trace.
- **If tests pass, behavior is proven.** Virtual clock + coverage/traversal
  tooling make behavior provable; untestable is treated as unfinished.

## Primitives and beliefs

- Minimal surface, refined primitives. Small API + trivial implementation = rare
  bugs. No competing APIs, no aliases - one way to do each thing.
- Errors **flow, never throw.** Errors are events and states, not exceptions in
  the runtime path.
- Composition over monolith: recipes combine primitives; use cases are never
  baked into the core API.

## Package topology

- **core** + **sugar** are the runtime; everything else must earn its place by
  serving the ecosystem.
- **traversal** - graphs, coverage, history; the seed for behavior proof and
  later visualization (coverage trees become visualizations).
- **test** - assertions for actor behavior.
- **examples** - recipes proven in real usage (including justus).
- **utils** - shared bottom layer; only core may import it.
- New packages answer two questions: does it serve the ecosystem (testing,
  visualization, ergonomics)? Does it obey the package rules?

## The testing story (what justus needs)

- Virtual clock enables deterministic tests of time-dependent flows (sync,
  retries, timeouts) without flakiness.
- Coverage/traversal proves paths through complex machines - directly supporting
  justus's promise that (almost) all logic is provably correct.
- Mutation-tested: passing tests should mean the behavior is actually proven.

## Open technical questions

- How much of justus's logic stays in Mantaq vs. thin host glue (target is
  "almost all").
- Visualization: turning traversal coverage trees into a usable dev view.
- Performance envelope for large machines / high event rates in a p2p app.
