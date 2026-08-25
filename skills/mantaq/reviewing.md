# Reviewing Mantaq Actors

Check your actor code against mantaq conventions. Catches the bugs that typechecking misses.

## Structure

- Every async job lives in an effect, not a transition handler. Transition handlers stay pure: read context, decide state, emit.
- States model domain, not booleans. No `isLoading`, `hasError` flags in context doing a state's job.
- One way to do things. No competing patterns for the same behavior.

## Determinism

- All timing through the injected clock. Real
  `setTimeout`/`Date.now`/`Math.random` in effects = nondeterministic
  actor = flaky tests.
- Same inputs, same trace. Any environment-dependent read in logic is a bug.

## Typing

- Payload types declared at every boundary: `state("x")<T>()`,
  `event("x")<P>()`. Bare `state("x")()` leaves payload `unknown`.
- Handler args inferred from refs. No casts, no `any`.
- `context.set` is the write signal. Any `set()` fires `change`, even
  with the same reference. Context is user land: mutate the record in
  place, then `set()` it. Mutating without `set()` leaves subscribers
  silent.

## Effect Lifecycle

- Every effect wires the abort signal and checks `signal.aborted` before emitting. No work survives transition.
- Timer/interval ids cleared on abort where immediate cleanup matters.
- Effects never run on the initial state. Code relying on boot effects is
  dead.

## Wiring

- Every emitted event declared (`internal`/`outputs`) and handled in every state that can receive it. No `[Actor] no transition for event "X"...` warnings.
- Emit routing by declaration, not by the emit call.
- `actor.state` reads inside `m.on` handlers branch on the PREVIOUS
  state. Branch on payload/context, or move to `onAny` where it's
  applied.
- Emit loops bounded. `internalBudget` default 10,000 halts a runaway
  drain. A chain of 20 emits should raise eyebrows.

## Errors

- Errors are states and events, never exceptions. Recoverable → non-final state + retry. Terminal → final `failed` state.
- Each error arc has a test that reaches it.

## Tests

- VirtualClock everywhere. No real timers, no `await` sleeps.
- Happy path + failure paths. Coverage assertions prove all states/transitions exercised.
- No leaked timers after tests (`clock.hasPending()`).
