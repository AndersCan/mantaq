# Reviewing Mantaq Actors

Review actor code against the Rules in `SKILL.md`, then check what typechecking misses. Written against `@mantaq/core` 0.5; when behavior is in doubt, check the installed package.

## Structure

- Async work lives in effects. Transition handlers stay pure: read context, decide state, emit.
- States model the domain. No `isLoading` / `hasError` flags in context doing a state's job.
- One way to do things. No competing patterns for the same behavior.

## Determinism

- No real `setTimeout` / `Date.now` / `Math.random` in logic or effects. Any environment-dependent read is a bug.

## Docs

- Every state, event and handler has a one-sentence doc comment in domain words. The live page shows it.

## Typing

- No casts, no `any`. Payload types declared at every boundary.
- Events built with `.create()`, not hand-built objects.
- Context is plain, cloneable data: no actors, functions or class instances.
- Mutated context is written back through the write signal, or subscribers stay silent.

## Effects

- Every effect has a unique camelCase `name` and declares `sends`.
- Honours the abort signal, checks `signal.aborted` before emitting, passes the signal to timers.
- Async effects return their promise.
- Actor tolerates effects running at construction (initial state).

## Wiring

- Every emitted event is declared and handled in every state that can receive it.
- Handlers read the current state from their `state` argument, not `actor.state`.
- Emit chains are short and bounded. A chain of 20 emits should raise eyebrows.

## Errors

- Expected failures are states and events, not throws. A throw ends in the terminal error state; `recover()` is a last resort.
- Each error arc has a test that reaches it.

## Tests

See `testing.md`: VirtualClock only, happy path plus every failure arc, no leaked timers.
