# 0003. Navigation is a step log; live runs go through a driver

Status: accepted. Closes #288. Covers the design of #303.

## Context

Navigation today is a static walk: `movesFrom`, `encodeStep` and `decodePath`
(`packages/viz/src/moves.ts:58,106,118`) with a `?step=` URL. The viz README says "Nothing runs.
Guards are not evaluated". A step engine already exists: `execute(target, steps)` replays `VizStep`s
on a fresh actor and `VirtualClock`, recording from, event, to, transitioned, effects, context and
handler errors (`packages/inspect/src/fuzz/run.ts:117-178`). It imports only viz types, core and utils
(`run.ts:1-3`), so it is browser-safe. Core's `transition` event already reports which effects ran
(`run.ts:142`). `VirtualClock.pendingTimers()` returns `{ id, deadline, ms, eventName? }`
(`packages/core/src/virtual-clock.ts:34,194`).

## Decision

1. Navigation state is `{ machine, steps: VizStep[] }`, replayed on a fresh actor.
   Back = replay minus the last step. Reset = empty log. Share = URL. Fork = edit the log.
2. Initial context comes from the factory. No separate context editor in v1.
3. viz defines a `VizDriver` interface (`reset()`, `step(step)`; JSON in, JSON out; no core import).
   inspect implements it on the same step function the fuzzer uses, so live and fuzz share one engine.
4. Live needs a factory on `VirtualClock`. Instance or `RealClock` machines fall back to the static
   walk with a note.

## Rejected options

- **viz imports core and runs actors.** viz stops being a pure reader and gains a core dependency.
- **Recorded traces or journeys.** Rejected in #303 and already removed (#305).
- **Mutable in-place stepping with an undo stack.** A second state model; replay is exact and the log
  is already the shareable form.

## Consequences

- Undo, share and what-if forks are the same operation on one serialisable log.
- Live runs real effects in the browser; machines touching network or storage need factory-injected
  ports, otherwise they stay static-only.
- Timer labels depend on sugar passing `eventName` (ADR 0004; planned).
- `VizDriver` is not yet implemented.
