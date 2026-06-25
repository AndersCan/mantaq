# Mantaq Vision

High-level guide. All contributors abide. Philosophy, not rules.

What mantaq is. What mantaq believes. What mantaq rejects. What good looks like.

## Mantaq Is

Actor-model state machine library. TypeScript. Minimal primitives.

Kills complexity: state explosion, derived state, concurrency, side effects.

Core primitives: States + Events, Context, Effects, Regions/Composition, Clock.

## North Star

**If it typechecks, it runs correct.**

Type = behavior. Any divergence between type and runtime is a design bug. Pursue 100% type safety. Nothing stringly typed.

This is not aspiration. This is the test of every PR.

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
