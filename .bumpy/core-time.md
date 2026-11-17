---
"@mantaq/core": minor
"@mantaq/sugar": minor
"@mantaq/traversal": patch
"@mantaq/inspect": patch
---

Breaking: an actor has a clock only when you give it one, and a timer without a clock does not compile.

- `Actor({ … })` with no `clock` has no time: `actor.clock` is `undefined` and its effects' `input` has no `clock`. `input.clock.setTimeout(…)` in such an actor fails with `Property 'clock' does not exist`, and `withTimeout(…)` with `Property 'clock' is missing`. Before: `create: () => Actor({ …, setup: (m) => m.effect(s, { name: "wait", fn: (input) => withTimeout(3000, { input, event }) }) })` ran on a real clock. After: `create: ({ clock }) => Actor({ clock, … })`.
- `RealClock` is no longer exported. Real time comes from `machine(id, { create })`, whose `create` gets a real clock unless a test or tool passes one. Before: `Actor({ clock: RealClock() })`. After: `machine("id", { create: ({ clock }) => Actor({ clock, … }) })`.
- `AnyActor.clock` is optional, so an actor without a clock is accepted wherever any actor is.
- sugar: `createPool` has no `clock` option. The pool's inbox and workers have no clock. Before: `createPool({ name, workers, run, clock })`. After: `createPool({ name, workers, run })`.
- sugar: `withTimeout` called without a clock throws `withTimeout(<ms>): this actor has no clock. Pass the clock create() gets to Actor({ clock }).` and the machine goes to its error state. With types this cannot happen; it can with a cast or from JavaScript.
- A `clock` typed `Clock | undefined` is read as a clock unless `exactOptionalPropertyTypes` is on. Pass a `Clock`.
- sugar parts (`definePart`, `withParts`) are typed as if the actor has a clock. A part with a timer on an actor without one fails when the timer starts, not at compile time.
