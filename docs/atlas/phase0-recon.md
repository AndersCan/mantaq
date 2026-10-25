# Atlas Phase 0: recon

Verified against code at `origin/main` (02478ee). `@mantaq/viz` was parked in `9841e2c`; recoverable from `9841e2c^` for reference only.

## What `@mantaq/traversal` already gives

Exports to build on: `buildGraph`, `instrument`, `createHistory` / `History`, `parseInternalEventIds`, `INITIAL_NODE_ID`, types `ActorGraph` / `GraphNode` / `GraphEdge`.

- `buildGraph(actor, { sampleContexts })` → `{ nodes, edges }`. Nodes: id, label, `isFinal`, `isInitial`, `isActive`. Edges: id, source, target, label (event), `isUndetermined`, `isInternal`, `contexts`, `payload.action` (`emit(...)`). Recurses into `actor.regions` (ids path-prefixed: `region.state`). Adds `effect:<state>` self-loops and a synthetic `__initial__` node.
- Edges are discovered by **calling every handler with a synthetic event (`payload: {}`)** and a sample context. Not static analysis.
- `instrument(actor)` → proxy with `history` (state visits, transitions, effects, sends). Transitions are list entries, so hit counts are derivable.

## Verified limitations (drive later phases)

1. **Handlers reading live actor state are undetermined.** Checkout's `back` reads `actor.state.name`; every `back` edge comes out `to: null`. Explanation belongs to Phase 4.
2. **Payload-dependent branches show one branch only.** A handler `amount > 100 ? rejected : approved` yields a single determined edge (`approved`) with synthetic `{}`. The other branch is invisible, not marked unknown. Phase 3 (fuzzing) or Phase 4 (AST) must surface it. Atlas v1 cannot flag this.
3. **No payload type names at runtime.** Schema carries `payloadType: null`.
4. **No explicit hierarchy.** Regions are child actors, not state-hosted. Atlas derives `region` from the id prefix.
5. **`History` cannot tell an ignored event from a self-loop** (`from == to`). Edge hits match by source + event + target, which is correct unless both a self-loop and an ignored event share (from, event).
6. **Example machines are not importable.** They live inside `*.test.ts` files (`createCheckoutActor` etc.). Importing registers tests.

## `viz`

Parked. Used X6 + dagre + lit-html. Deleted as "too buggy to keep". Not extended; Phase 2 is a new, smaller viewer (see `phase2-viewer-spec.md`).

## Verdict

Phase 1 is a **small new package** (`packages/atlas`), no core changes, read-only over `traversal`.

## Open decision

Auth and saga snapshots (Phase 1 acceptance) need importable machines. Options: (a) extract factories from the examples into non-test modules, touching `checkout.test.ts` which is the docs registry parsed by `scripts/docs-check.mjs`; (b) mirror structure in atlas fixtures (done for checkout, drift risk). Needs owner call.
