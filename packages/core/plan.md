Model

Every state = node with zero+ regions. Region = substates, one active. Multiple regions = concurrent. Leaf = zero regions.

Hierarchy = one region. Parallel = many. Same primitive.

state(“x”) // leaf
state(“x”).region({ initial, states }) // hierarchical
state(“x”).regions({ r1: {…}, r2: {…} }) // parallel

Identity

Events + states have ref identity. Debug names optional, not unique.

const fetch = event<{ url: string }>()
e.constructor === fetch // dispatch check

States

const idle = state(“idle”)
const loading = state(“loading”)<{ url: string }>()
const done = state(“done”).final()

const conn = state(“connected”).region({
initial: “auth”,
states: { auth: state(“auth”), active: state(“active”) },
})

const player = state(“player”).regions({
playback: { initial: “paused”, states: { paused, playing } },
audio: { initial: “unmuted”, states: { unmuted, muted } },
})

Refs typed: conn.auth, player.playback.playing.

Targeting

go(conn) // initial child
go(conn.active) // deep, explicit

go(player.playback.playing) // other regions → initial
go(player, { audio: player.audio.muted }) // per-region override, unmentioned → initial

No history primitives. See footnote.

Context

Single typed record. Survives transitions. No implicit merge — return full ctx or omit.

context: () => ({
retries: 0,
inquiries: actorMap(inquiry),
heartbeatTimer: timer(30_000, heartbeatDue),
})

on(reset, ({ ctx }) => ({ ctx: { …ctx, retries: 0 } })) // explicit spread
on(noop, () => ({ next: idle })) // ctx omitted = unchanged

State payloads live only while state active. Parallel: each region’s active state has own payload.

Handlers

on: [
when(conn.auth, authOk, () => go(conn.active)), // specific
when(conn, disconnect, () => go(idle)), // any descendant
on(reset, ({ ctx }) => ({ ctx: { …ctx, retries: 0 } })),
on(child.outputs.disconnected, ({ event }) => ({ … })),
]

Handler receives { ctx, event, self, snapshot }. Returns { next?, ctx?, emit?, raise? }. Sugar: go(state, payload?), emit.x(payload).

self.send vs raise:

- self.send(event) — enqueue to internal queue. Available in effects and handlers. Same as { raise: event } return.
- { raise } return — declarative form. Patches merge into single transition step.

Resolution: leaf → root, first match wins per region; then any-state on in declaration order. Returning undefined falls through.

Guards = early-return undefined. No separate primitive:

when(playing.idle, hoverHovering, ({ ctx }) =>
ctx.isTouchDevice ? undefined : go(playing.hovering))

Parallel atomic transitions:

when(player, stop, () => go(player, {
playback: player.playback.paused,
audio: player.audio.muted,
}))

Unmentioned regions stay. Multi-region match: all fire, patches merged in region declaration order (deterministic, no warn). Multi-region ctx patch collision: last write wins, region declaration order. Silent. Convention: scope ctx keys per region (ctx.playback.x, ctx.audio.y) to avoid.

Self-transitions: go(s) from s exits and re-enters. Effects restart. Entry runs. To stay without re-entry, return ctx only.

Transient transitions

.always() runs synchronously on entry, before any external event, before subscribers see the state. Use for decision states.

const checking = state(“checking”).always(({ ctx }) =>
ctx.cached ? go(idle) : go(fetching))

Resolution: same as handlers. Returns go(…) or undefined only. Ctx-only patch = type error at build time. Undefined falls through. Multiple .always() chain in declaration order. Loops detected via internalBudget.

Effects

Declared on state. Run on entry, abort on exit via signal.

const conn = state(“connected”)
.effect(({ signal }) => keepalive(signal))
.region({ initial: “auth”, states: { auth, active } })

const loading = state(“loading”)<{ url: string }>()
.effect(({ state, self, signal }) => {
fetch(state.url, { signal })
.then(r => r.json())
.then(data => self.send(resolved({ data })))
})

Parent effects don’t restart on child transitions inside parent. Region effects in parallel node run concurrently. .effect() composes in declaration order (sequential invocation, not completion). Cleanup is signal-only. self.send enqueues to internal queue, never re-enters sync.

Timers

Runtime-scheduled, advance-able in tests. Live in context only. Handlers reset.

context: () => ({ heartbeatTimer: timer(30_000, heartbeatDue) })

when(loggingIn, logonAccepted, ({ ctx, event }) => ({
ctx: { …ctx, heartbeatTimer: timer(event.heartBtInt \* 1000, heartbeatDue) },
next: active,
})),
on(outboundSent, ({ ctx }) => ({
ctx: { …ctx, heartbeatTimer: ctx.heartbeatTimer.reset() },
})),

timer(ms, event) registers deadline. .reset() returns new handle, restarts. Timers live in context only. State exit does not auto-cancel. User cancels via handler or lets fire harmlessly. Periodic: re-arm in handler. Timer fires enqueue to external queue.

Error channel

Effect throw/reject → synth actorError on internal queue. If actor registers on(actorError, …): handled. If unhandled: forwarded to parent as child output (same channel as declared outputs). Parent can on(child.outputs.actorError, …). Unhandled at root: throw to host.

on(actorError, ({ ctx, event }) => ({ ctx: { …ctx, lastError: event.message } }))

Final states + onDone

Final leaf → region done. Node done when all regions done.

Each state with regions exposes state.done event ref. Fires when all regions complete, enqueued to internal queue. Use for sequenced phases.

const auth = state(“auth”).region({
initial: “idle”,
states: { idle, signingOut, signedOut: state(“signedOut”).final() },
})

on(auth.done, () => go(notAuthenticated))

Root done → actor reaped. Synthesized actorDone emits before reap.

const job = state(“job”).regions({
upload: { initial: “pending”, states: { pending, uploaded: state(“uploaded”).final() } },
metadata: { initial: “pending”, states: { pending, saved: state(“saved”).final() } },
})

on(job.done, () => go(complete))

Snapshots

actor.subscribe((snapshot) => void): Unsubscribe
actor.snapshot() // sync, recursive
actor.settled(): Promise<void> // resolves when both queues empty. Effects orthogonal.

Snapshot shape

// Leaf
{ path: [“idle”], regions: {} }

// Hierarchical (implicit region “default”)
{ path: [“connected”], regions: {
default: { path: [“active”], payload: undefined },
}}

// Parallel
{ path: [“player”], regions: {
playback: { path: [“playing”], payload: undefined },
audio: { path: [“muted”], payload: undefined },
}}

Ref queries on snapshot:

snapshot.activeLeaves(): State[] // all active leaves, ref-typed
snapshot.isIn(stateRef): boolean // ref in active config (leaf or ancestor)

isIn covers ancestors too: in conn.active, snapshot.isIn(conn) and snapshot.isIn(conn.active) both true.

Child actors

One primitive: actorMap. Two constructors:

actorMap(child) // open keys
actorMap(child, { keys: [“left”, “right”] as const }) // constrained / static

Singleton = constrained with single key. No separate constructor.

Shared API: spawn / send / sendIfExists / ensure / kill / killAll / get / has / keys / size.

spawn input: spawn(key, { input }) passes input to child’s context fn:

const inquiry = actor({
inputs: { … },
outputs: { … },
behavior: chart({
context: ({ input }: { input: InquiryInput }) => ({ … }),
…
}),
})

get(key) returns child actor handle with own .subscribe() / .snapshot() / .send().

Final auto-reaps. Children can’t reach parent.

Actors

const myActor = actor({
inputs: { fetch },
outputs: { done },
behavior: chart({ … }),
})

Expose child inputs:

inputs: {
masterToggled: event(),
left: expose(lightswitch), // all child inputs forwarded under “left” key
right: expose(lightswitch),
}
room.send(“left”, toggled())

expose(child) = forward every input of child actor under namespace. All-or-nothing: cannot filter or rename. Renames/filters/fan-outs → plain on handlers. No forward.

Testing

Harness and other test utilities are userland — see testing spec.

Event flow

Two queues

```
•	External queue: outside stimuli. actor.send, parent→child sends, timer fires, child outputs landing on parent.
•	Internal queue: consequences of current causal chain. self.send + { raise } from handlers, effect resolved/rejected re-entries, synthesized actorError, .always() resolution.
```

Dispatch loop

loop:
if internal not empty: take from internal
else if external not empty: take from external
else: idle
process event

Internal drains fully before next external. Causal chain stays contiguous; externals never interleave mid-chain.

Per-event processing

```
1.	Collect handlers: active leaves up through ancestors. Parallel: all regions contribute.
2.	State-bound when checked leaf → root, per region. First match per region wins.
3.	Any-state on checked in declaration order.
4.	Multi-region match: all fire, patches merged in region declaration order.
5.	Patches applied: context updated, outputs published, transition runs.
6.	Transition: exit effects aborted deepest-first; enter effects started shallowest-first.
7.	.always() runs on entered states, shallowest-first, before subscribers notified.
8.	If .always() transitions: loop from step 6.
9.	If region completes (all leaves final), parent state.done synth event enqueued to internal queue.
10.	self.send / { raise } from this event enqueues to internal queue; never re-enters sync.
11.	Subscribers notified with final snapshot of this step. Intermediate states traversed by .always() chains not emitted. Decision states invisible to subscription stream by design.
12.	Loop.
```

Starvation guard

Configurable per-actor cap on consecutive internal events per external (default 10_000).

actor({ …, internalBudget: 50_000 })

Overflow → synth actorError(“internal queue overflow”) on internal queue, actor halts. Bubbles via error channel (unhandled → parent output, root → throw to host). No silent drop. No remaining-event processing. .always() loops counted against budget.

Composition

Composed actor has leaf shape: { inputs, outputs, behavior }. Behavior = chart whose context holds child actor maps. Recursively composable. Strict one-way ref.

Non-goals

```
•	Cross-process actors
•	Visualization / static graph extraction
•	Cross-region guards (query snapshot)
•	Transition actions between exit + entry (use effects)
•	Synchronous (macrostep) semantics — RTC only, with two-queue causal grouping
•	History / deep history / resume — see footnote
•	Serialization / persistence / rehydration — see footnote
•	Tags, matchers, broadcast, debounce sugar — see cookbook footnote
•	Actor systems / cross-actor addressing — pass refs as input, or emit-and-forward
```

Footnote: why no history

History/resume cut from core. Rationale:

Expressible in userland. Snapshot exposes active paths per region. Ctx stores them. Re-entry passes per-region targets to go(). Full capability, no new primitives:

on(interrupted, ({ snapshot }) => ({
ctx: { …ctx, saved: snapshot.regions },
next: idle,
}))

on(resumed, ({ ctx }) => go(player, ctx.saved))

Cost of inclusion was high:

```
•	Payload + history collision (transient payload-states break clean resume)
•	Lifecycle rules (when memory clears: subtree exit, final, restart, manual clear)
•	Serialization schema for persisted history
•	Two modes (shallow/deep) doubling surface
•	Type machinery to restrict resume to region-bearing targets
```

Cost of exclusion low:

```
•	One cookbook pattern covers it
•	Users wanting resume already track ctx for related concerns
•	Path resolution helper ships as utility (~10 lines)
```

Footnote: no serialization in core

Persistence + rehydration not provided. Deliberate.

Live actor holds non-serializable refs: timer handles, AbortSignals, child actorMap handles, effect promises mid-flight. Auto-stripping these = magic with sharp edges. xstate ships persistence as core (getPersistedSnapshot + { snapshot } arg) and the bug list is instructive: history restore breaks across round-trip (historyValue restored as POJO instead of StateNode ref, falls back to initial state); spawned actors rehydrate as dead refs that don’t forward events to parent; undefined ctx fields blow up JSON.stringify in common host environments. These are not edge cases — they are the obvious shape of the problem. Every framework that ships serialization in core hits them.

We don’t ship it. Two userland paths:

1. Snapshot. snapshot.toJSON() recursive walk of { path, payload } per region is straightforward to write — ~20 lines. User owns payload JSON-safety, ctx serialize/deserialize, child tree walk, timer rehydrate via timer(ms, event, { deadline }). Same bugs as xstate, but user-visible and user-owned, not buried in framework.
1. Event sourcing. Keep the event log, replay through fresh actor on rehydrate. Events are already plain data by contract (event<T>() where T is serializable). No ref-stripping needed — replay rebuilds refs. Effects must gate on a replaying flag the user threads through; compaction reduces log size by folding redundant events (last-write-wins per key, drop self-cancelling pairs, etc.). Cleaner shape than snapshot for most cases. History bug + spawned actor bug don’t exist because tree is rebuilt, not restored.

Recommendation: event sourcing for crash recovery + audit + time travel. Snapshot for cold-start UI state where you want one JSON blob. Pick per use case, write the ~50 lines, own the bugs. Don’t put it in core.

Footnote: cookbook over primitive

Design principle: prefer userland recipe over core primitive when recipe is short and variation across users is high. Smaller core, fewer concepts, no edge cases. Users build flavor they need.

Cut from core, shipped as cookbook:

Tags. Userland over activeLeaves() + isIn():

function tag<S extends AnyState>(…states: S[]) {
const set = new Set(states)
return { has: (snap) => snap.activeLeaves().some(s => set.has(s)) }
}
const busy = tag(loading, submitting, refetching)
if (busy.has(snap)) showSpinner()

Variations: predicate tags, hierarchical groups, tags spanning child actors. Each user picks shape.

Matchers. snapshot.matches(s) = snapshot.isIn(s). Already in core under isIn name. Userland alias if needed.

Broadcast to actorMap.

const broadcast = (map, event) => { for (const k of map.keys()) map.send(k, event) }

.after(ms, event) state-level sugar.

const after = (ms, event) => (s) => s.effect(({ self, signal }) => {
const id = setTimeout(() => self.send(event), ms)
signal.addEventListener(“abort”, () => clearTimeout(id))
})
const debouncing = after(500, fired)(state(“debouncing”))

What stayed in core:

```
•	self / raise in handlers — event ordering, can't be userland
•	.always() — synchronous-on-entry timing, can't be userland
•	state.done event ref — runtime owns the lifecycle event
•	activeLeaves() / isIn() on snapshot — exposes runtime state, unblocks userland
•	actor.settled() — queue drain signal, can't be userland
```

Test: can it be written with public primitives without timing compromises? If yes, cookbook. If no, core.

Reassess if userland pattern proves brittle or universally rewritten the same way. Easier add later than remove.

Other changes from v5

```
•	actor.settled() added. Resolves when both queues empty. Effects orthogonal.
•	Testing section replaced — harness removed from core. Harness is userland (separate package).
```

Other changes from v4 (carried)

```
•	.onDone(handler) builder method removed. Replaced with state.done event ref — fires when all regions complete, enqueued to internal queue. Handle via on(state.done, ...).
•	.always() return type narrowed: returns go(...) or undefined only. Ctx-only patches = type error.
•	Timers context-only. Payload timer scope removed. State exit does not auto-cancel; user cancels via handler.
•	Unhandled actorError bubbles: handler missing → forwarded to parent as child output (same channel as declared outputs). Root unhandled → throw to host.
•	internalBudget overflow halts actor. Bubbles via error channel. No silent drop, no remaining-event processing.
•	Subscriber stream skips .always() intermediate states. Decision states invisible by design.
•	runCancellable sugar mention removed. Pattern obvious from loading example.
•	Multi-region ctx patch collision: last write wins, region declaration order, silent. Convention: scope ctx keys per region.
•	passthrough renamed to expose.
•	Serialization explicitly out of core. Footnote added explaining why (xstate bugs cited) and pointing users to event sourcing or userland snapshot recipe.
```

Other changes from v3 (carried)

```
•	self exposed in handler context (not just effects). { raise } return field.
•	.always() transient transitions added.
•	snapshot.activeLeaves() + snapshot.isIn(stateRef) added.
•	Spawn input semantics documented: spawn(key, { input }) → child context fn receives { input }.
•	Guards documented as early-return undefined. No new primitive.
•	Self-transition semantics made explicit: go(s) from s re-enters.
•	Cookbook footnote: tags, matchers, broadcast, .after — all userland.
```

Other changes from v1 (carried)

```
•	Shallow merge removed. Ctx returns are full or omitted. Explicit spread required.
•	Multi-region merge warn removed. Order deterministic (region declaration), document it, no warn.
•	actorMap constructors collapsed to one with optional keys. Singleton/static via constraint.
•	Starvation guard configurable per actor.
```
