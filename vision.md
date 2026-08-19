# Mantaq Vision

High-level guide. All contributors abide. Philosophy, not rules.

What mantaq is. What mantaq believes. What mantaq rejects. What good looks like.

## Mantaq Is

Actor-model state machine library. TypeScript, ESM only. Minimal primitives.

Kills complexity: state explosion, derived state, concurrency, side effects.

Core primitives: States + Events, Context, Effects, Regions/Composition, Clock.

## North Star

Three claims. Each is a machine check, not taste. Divergence is a design bug.

- **If it typechecks, it runs correct.** Type = behavior. Nothing stringly typed. Any gap between type and runtime is a design bug.
- **ESM only, no dual package.** One module graph, one module instance, one registry. No CJS. No dual-package hazard: dual builds spawn two core copies with two module-scoped registries, and cross-copy reads silently break. ESM-only keeps single-instance guarantees true.
- **If it runs, it runs deterministic.** Same inputs, same trace, always. The runtime never reads the wall clock, randomness, or environment. One clock, injectable.
- **If tests pass, behavior is proven.** Virtual clock, mutation-tested. Untestable is unfinished.

This is not aspiration. This is the test of every PR.

## Ecosystem

core and sugar are the runtime. Every package around them must earn its place by serving the ecosystem, not the internals:

- **traversal** — graphs, coverage, history. Behavior proof for testing; later, fuel for visualization.
- **test** — assertions for actor behavior.
- **examples** — recipes proven in the real.
- **utils** — the shared bottom layer. core may import it; nothing else does.

New package, two questions: does it serve the ecosystem (testing, visualization, ergonomics)? Does it obey the package rules? Graphs are the seed — traversal's coverage trees become the viz.

## Beliefs

- **Abstractions matter.** Other libs ship more. Mantaq ships less, refined. Small surface + trivial impl = rare bug. The one belief others do not hold.
- **Modular primitives.** Small primitives that combine to solve common patterns. No use case baked into the API.
- **Small surface, small impl.** Concise DX API. Trivial implementation, no gymnastics. Complexity in impl is a bug, not a fact of life.
- **Testing first.** Virtual clock, deterministic tests. If a feature is untestable, mantaq failed.
- **Errors flow, never throw.** Errors are events and states. Exceptions do not belong in the runtime behavior.
- **One way to do things.** No competing APIs. No aliases for the same behavior. One path; the right one.
- **Modular primitives union beats monolithic API.** Recipes compose primitives. Surface stays small.

## What mantaq Rejects

- **Scope creep.** No new primitive without deep reasoning and thought.
- **Brute force coding.** Thinking beats typing. Forcing the compiler quiet = wrong path.
- **Type-runtime mismatch.** Type must match behavior. Any gap is a design bug.
- **Complex impl when trivial impl exists.**
- **Hidden side effects.** Context leaking across states. Mixed queues. Forgotten abort checks.
- **Repeated pain ignored.** See a smell twice, refactor. A human notices; an agent must too.

## How This Vision Is Used

- High-level guide. All contributors — human and agent — abide.
- Philosophy only. Mistakes-to-avoid, rules, and anti-patterns live in `AGENTS.md`, lint, tests.
- Code review check: does the change honor the beliefs above? If not, the change is wrong.

## The One Thing

**Abstractions matter.** Most libs pile features to cover cases. Mantaq refines primitives until the cases compose themselves.
