# @mantaq/viz v2 — Rebuild Plan

**Status:** Plan. No code yet.
**Purpose:** A buildable blueprint for a state-machine visualizer that AI agents can construct without producing the broken/ugly UI of the v1 attempt (`packages/viz`, built June–Aug 2026, deleted in the north-star cleanup).
**Method:** This plan is the synthesis of a git-history postmortem, the surviving `ux-research/` artifacts, and library/UX/QA research (plus two adversarial design reviews of this document). Every decision is chosen for (a) correctness by construction, (b) LLM-buildability, (c) "looks right" as a machine check.

---

## 0. TL;DR

Build **`@mantaq/viz`** — a live, embeddable state-machine inspector in **React 19 + React Flow v12** with **dagre** auto-layout, **plain scoped CSS + one design-token file + Radix primitives**, a **custom segmented timeline scrubber**, and **Playwright golden screenshots + per-fixture structural assertions** as the acceptance gate.

Three architectural bets that prevent the v1 failure class:

1. **Spec-first, contract-enforced.** `index.ts` _is_ the API. Every component gets a written spec (finite props, finite states, empty/error/disabled render contracts). Types and lint make the spec machine-checkable.
2. **Data layer is deterministic, pure, and framework-agnostic** (`@mantaq/viz/core`), built on the public `@mantaq/core` + `@mantaq/traversal` API — never on internals. The graph is recomputed when the machine's _state changes_ (edges depend on live state), not rebuilt per render. The renderer is a thin, typed adapter.
3. **"The UI renders correctly" is a CI gate.** A fixture gallery renders every real example actor + every edge case, and golden screenshots (Linux-only baselines) _plus structural assertions_ fail the build on any regression. The harness and gate are built in the first two phases, before feature breadth.

**Non-goals (v1 scope traps, deliberately cut):** no web component wrapper, no SVG/PNG export, no codegen, no context editing, no actor rewinding (scrub is visual-only), no drag-to-layout, no region container nesting / per-region layout in v1, no payload editing in the event palette, no search/minimap.

---

## 1. Why v1 failed (postmortem → guardrails)

Full postmortem: `ux-research/viz-prioritization.md` (18-item audit) + git history. The ten failure modes and the guardrail that neutralizes each:

| #   | v1 failure                                                                                                                                                                                                                                         | Evidence                                | v2 guardrail                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No public API contract.** `index.ts` exported only side-effect imports while README documented `buildGraph`/`computeNodePositions`/`renderActorFlow` → `import { buildGraph } from "@mantaq/viz"` was `undefined`. Survived two engine rewrites. | audit #3 (I×F=25, worst issue)          | `index.ts` is the spec (Phase 0). An "every §3 export resolves through the package path" test ships in **Phase 1** (not Phase 5) and a full type-level contract test ships in Phase 5.                                                                                 |
| 2   | **Built on core internals.** Read `actor.options.transitions`, `actor.clock.pendingTimers`, `actor.regions` via casts. Core rewrote its Actor API twice in one week and deleted those shapes → viz structurally dead.                              | commits `4a5d28e`, `ee88c0a`, `9841e2c` | v2 consumes **only** public API: `@mantaq/traversal.buildGraph`, `actor.on("change"                                                                                                                                                                                    | "transition" | "done")`, `snapshot()`, `clock.now()`. If data is missing, add it to core/traversal **first** (small, tested) — never cast. |
| 3   | **Engine whiplash.** Lit/nanostores → React Flow → X6 in 3 days. Stale skills, dead code, docs flip-flopping.                                                                                                                                      | commits `3366031`, `130ae6f`            | One stack, locked: React 19 + React Flow 12. Every alternative was evaluated (Section 4).                                                                                                                                                                              |
| 4   | **Silent failure culture.** `try/catch` → empty graph; `console.error` as UX; blank canvas as the error UI; arrays/functions dropped from the context viewer with no row.                                                                          | audits #4, #5, #6                       | **Blank canvas is forbidden.** Specified empty/error/unsupported-value renders for every component (Section 7). Errors are values (`VizError`), never swallowed.                                                                                                       |
| 5   | **Type-cast accumulation as architecture.** X6 module shim, `as ComplexAttrValue`, `as any` in `vite.config.ts`.                                                                                                                                   | audits #9, #10                          | `typescript/no-explicit-any` is already a repo-wide error. Zero casts: first-party-typed React Flow, typed data model, `assertNever` exhaustiveness.                                                                                                                   |
| 6   | **Docs-as-fiction.** `TESTING-LLM.md` claimed 21 test files / 663 tests; actual was 3 / ~34. README documented unimplemented shortcuts. LLMs read the fiction and generated more.                                                                  | audits #1, #16                          | No doc claims anything that isn't in the code. README/specs generated from code or verified against exports. Docs are in the plan's exit criteria, never ahead of it.                                                                                                  |
| 7   | **Test theater.** 16 committed screenshot PNGs, `headless: false`, 3 real test files. Browser "tests" never ran in CI.                                                                                                                             | commit `52cf27c` + repo audit           | Playwright golden suite is a first-class CI job, headless, from Phase 1. Screenshots are _generated_ baselines with structural assertions, never hand-committed evidence. Linux-only baselines (Section 9).                                                            |
| 8   | **Determinism ignored.** `Date.now()` timeline timestamps, `setTimeout` highlights. "Same inputs, same trace" was aspirational.                                                                                                                    | `transition-timeline.ts`                | Timeline time = `actor.clock.now()` (VirtualClock = deterministic replay). No `Date.now`/`Math.random` in the render path (Section 8). Fixture pre-scripting makes the _graph's_ build-time state deterministic too (Section 6.1).                                     |
| 9   | **Full re-render on every interaction.** Every click/setting → `buildGraph` (which _executes transition handlers_ as dry-runs) + re-layout + `zoomToFit`. Jank, flicker, phantom nodes from undetermined edges.                                    | audits #11, #12                         | Graph rebuilds only when the **active path changes** (edges depend on live state — the honest model, not "build once"); layout is memoized on the structural fingerprint; context-only changes flip flags via `applyLive`; `zoomToFit` never auto-fires (Section 6.4). |
| 10  | **Optimized the wrong layer.** The ralph loop split monoliths and killed casts but never questioned the design (re-render storm, internal coupling, handler-execution-as-graph-discovery).                                                         | commit `8259509` + follow-ups           | Design fixed here, in the plan. Phase ordering puts foundations and the "it renders correctly" gate before feature work.                                                                                                                                               |

**Design debt that survives and is reused:** the UX research is good. `ux-research/actor-ui-design.md` (identity card, effect badges, active path, event palette, timeline, context diff, region nesting, trust footer) and `ux-research/personas-and-journeys.md` (XState Refugee, UI Debugger, Library Builder, Team Lead) define the product. `@mantaq/traversal` (`buildGraph`, `instrument`, `collectActiveStates`) is the proven graph pipeline and the only graph source.

---

## 2. Product definition

**What it is:** an embeddable React component that renders a Mantaq actor as a live state graph and lets you (a) see where the actor is, (b) fire its events, (c) inspect context, (d) scrub its transition history. The "I can fix anything if I can see it" UI Debugger persona is the primary user; docs embeds and team demos are secondary.

**Where it's used:** docs site (Astro islands, Phase 5), user dev/debug pages, READMEs. Embeddable, near-zero-config, dark+light, themed by CSS custom properties.

**The three surfaces (all one product):**

1. **Understand** — the state graph: states, transitions, effects as node badges, active path highlighted, final/initial/undetermined semantics visible. One glance = one answer.
2. **Drive** — event palette sends events into the live actor; the graph reacts.
3. **Debug** — context inspector with diff view; transition timeline scrubber; errors surfaced, never swallowed.

**Scope guardrails (what v1 proved kills us):** every feature must survive the "can an AI agent build it without a browser?" test — that is, the fixture gallery + golden gate must make breakage visible. Any feature that can't be golden-tested is deferred.

**Persona-driven priorities (from `actor-ui-design.md`):** P0 Identity Card + Active Path + Event Palette; P1 Effect Badges + Timeline; P2 Region Nesting + Context Diff. All in v2 except **Region Nesting** (rendered flat in v1; group rendering + per-region layout are Phase 5+ extensions) and **Trust Footer** (test counts/version aren't readable at runtime — cut permanently).

---

## 3. The public API (index.ts is the spec)

Two entry points in one package `@mantaq/viz`:

### `@mantaq/viz` — React components

```ts
export { Viz } from "./components/viz"; // batteries-included composite
export type { VizProps, VizOptions } from "./components/viz";
export { StateGraph } from "./components/state-graph"; // the graph alone
export type { StateGraphProps } from "./components/state-graph";
export { EventPalette } from "./components/event-palette";
export type { EventPaletteProps } from "./components/event-palette";
export { ContextInspector } from "./components/context-inspector";
export type { ContextInspectorProps } from "./components/context-inspector";
export { TransitionTimeline } from "./components/transition-timeline";
export type { TransitionTimelineProps } from "./components/transition-timeline";
export { ActorBadge } from "./components/actor-badge";
export type { ActorBadgeProps } from "./components/actor-badge";
export { ErrorBanner } from "./components/error-banner";
export type { ErrorBannerProps } from "./components/error-banner";
export { VizProvider, useActorModel } from "./model"; // data hooks
export type { ActorModel, VizError } from "./model";
```

### `@mantaq/viz/core` — framework-agnostic, deterministic, node-testable

```ts
export { buildVizGraph } from "./core/graph-model";
export type {
  VizGraph,
  VizNode,
  VizEdge,
  VizGroup,
  VizResult,
  VizErrorReason,
} from "./core/graph-model";
export { layoutGraph } from "./core/layout";
export type { LayoutOptions, LayoutResult, LayoutDirection } from "./core/layout";
export { Timeline, createTimeline } from "./core/timeline";
export type { TimelineOptions, TimelineState, TimelineEntry } from "./core/timeline";
export { diffContext } from "./core/diff";
export type { ContextDiff, DiffEntry } from "./core/diff";
export { formatValue, formatTime, formatEventName, formatStatePath } from "./core/format";
```

### Styles — consumer-facing CSS contract

```ts
// export "./styles.css" — single compiled stylesheet (tokens + base + all components + React Flow CSS)
import "@mantaq/viz/styles.css";
```

**Rules (v1 audit #3, fixed by construction):**

- Nothing is documented in README that isn't in the `index.ts` files above.
- Nothing is exported that isn't tested via the public import path.
- No `Internal*`, no React types leaking into `@mantaq/viz/core`, no `as any`.

---

## 4. Technology decisions (the "find libraries that can help" answer)

Every choice was researched for: maintenance, TypeScript quality, LLM-buildability (training-data footprint, docs/examples volume), and fit. Rationale summaries; full comparisons in research notes.

| Concern               | Decision                                                                                                                                    | Why (and what lost)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph rendering       | **`@xyflow/react` v12** (React Flow)                                                                                                        | First-party TS, declarative React model, native subflow/group support for future region nesting, SSR/Astro-island support, 38k stars + 80+ official examples = best LLM training corpus. **Lost:** AntV X6 (the v1 engine — imperative mutation API, generics erase to base classes → the cast culture that killed v1), Cytoscape (imperative canvas, no React nodes), D3 hand-rolled (reproduces the imperative trap).                                                                                                                                                                                              |
| Layout                | **`@dagrejs/dagre` v3** (sync, flat in v1)                                                                                                  | Cycles handled internally by greedy acyclicer → the v1 infinite-loop bug class is _structurally impossible_ (no hand-rolled topo sort). 16 KB gz, official React Flow example ~30 lines, bundled types. Region subgraphs (per-region layout) are a Phase 5+ extension, not v1. **Escalation path:** elkjs layered if per-region layout later needs compound support.                                                                                                                                                                                                                                                 |
| UI styling            | **Plain scoped CSS + one `tokens.css`** (stable `mtq-` prefixed class names, compiled to a single `dist/styles.css`) + **Radix primitives** | Deterministic, ships as _static_ CSS (no consumer build step — CSS Modules were rejected precisely because hashed classes are generated by the consumer's bundler). One token file mechanically prevents style drift (the v1 UnoCSS dead-token mess). Radix (popover/select/tooltip/tabs/switch/dialog/slot) for accessible widgets; **shadcn patterns copied, never installed**. **Lost:** Tailwind v4 (impossible to ship cleanly from a library — consumer must run Tailwind; LLM class soup), MUI/Ant (100KB+ + theme systems), CSS Modules (not static), framer-motion (CSS transitions suffice for 2 effects). |
| Timeline              | **Custom ~300-line component** (no library)                                                                                                 | Discrete segmented scrubber (Redux DevTools / React DevTools pattern) is a controlled component over an ordered entry array — a library adds nothing. **Lost:** vis-timeline (Gantt-oriented, anti-React), react-chrono (no scrub semantics), recharts (wrong axis model).                                                                                                                                                                                                                                                                                                                                           |
| Browser testing       | **`@playwright/test` + a Vite fixture harness**                                                                                             | `toHaveScreenshot` with committed Linux baselines, `page.clock.setFixedTime`, animations disabled, plus per-fixture structural assertions (Section 9.5). **Lost:** Storybook (addon-playwright is a 58-star community project; Chromium-only goldens; ESM-only, heavy config), vitest browser mode (known clipping bug in its orchestrator iframe — exactly the React Flow scrollable-canvas risk).                                                                                                                                                                                                                  |
| Component tests       | **vitest + happy-dom + @testing-library/react** (per-file `// @vitest-environment happy-dom` pragma)                                        | Fast gate under `vp test`; Playwright is the authoritative browser gate. React Flow gets minimal component-level coverage (happy-dom's `DOMMatrix`/measurement shims are weak — a tiny setup shim is allowed, but canvas rendering is Playwright's job).                                                                                                                                                                                                                                                                                                                                                             |
| Time/determinism      | `actor.clock.now()` (VirtualClock), logical `seq` counter                                                                                   | VirtualClock is deterministic and monotonic → "same inputs, same trace". RealClock fallback: `seq` is the replay axis, `t` is cosmetic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Icons / class joining | `lucide-react`, `clsx`                                                                                                                      | tree-shakable / tiny `cn()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Dependency list

```jsonc
// packages/viz/package.json
{
  "peerDependencies": { "react": "^19", "react-dom": "^19" }, // repo has no peerDeps today; a React library requires them
  "sideEffects": ["*.css"],
  "dependencies": {
    "@mantaq/core": "workspace:*",
    "@mantaq/traversal": "workspace:*",
    "@mantaq/utils": "workspace:*",
    "@xyflow/react": "^12.11",
    "@dagrejs/dagre": "^3",
    "@radix-ui/react-popover": "^1.1",
    "@radix-ui/react-select": "^2.2",
    "@radix-ui/react-tooltip": "^1.2",
    "@radix-ui/react-switch": "^1.2",
    "@radix-ui/react-tabs": "^1.1",
    "@radix-ui/react-dialog": "^1.1",
    "@radix-ui/react-slot": "^1.2",
    "clsx": "^2",
    "lucide-react": "^0.5",
  },
  "devDependencies": {
    "react": "^19",
    "react-dom": "^19",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@typescript/native-preview": "7.0.0-dev.20260707.2", // required by dts.tsgo
    "@vitejs/plugin-react": "^5",
    "happy-dom": "*",
    "@testing-library/react": "*",
    "@testing-library/dom": "*",
    "@testing-library/user-event": "*",
    "@playwright/test": "^1.62",
    "@fontsource/inter": "*",
    "@fontsource/ibm-plex-mono": "*",
    "typescript": "^7.0.2",
    "vite": "catalog:",
    "vite-plus": "catalog:",
    "vitest": "catalog:",
    "@vitest/coverage-v8": "catalog:",
    "@types/node": "^26.2.0",
  },
  "scripts": {
    "build": "vp pack",
    "dev": "vp pack --watch",
    "test": "vp test",
    "check": "vp check",
    "coverage": "vp test run --coverage",
    "prepublishOnly": "vp run build",
    "prepack": "vp run build",
    "browser:build": "vp build --config browser/vite.config.ts",
    "browser:preview": "vp preview --config browser/vite.config.ts --port 4173 --strictPort",
    "serve:test": "vp build --config browser/vite.config.ts && vp preview --config browser/vite.config.ts --port 4173 --strictPort",
    "test:browser": "playwright test",
  },
}
```

Version catalog: add `react`, `react-dom` (+ types) and `@playwright/test` to `pnpm-workspace.yaml`; add `apps/docs` `@astrojs/react` in Phase 5.

### Package/workspace constraints (verified against repo)

- `exports`: `{ ".": "./src/index.ts", "./core": "./src/core/index.ts", "./styles.css": "./src/styles/styles.css", "./package.json": "./package.json" }` (pack rewrites to dist). `"files": ["dist"]`, `"type": "module"`.
- `tsconfig.json`: extend root; add `"jsx": "react-jsx"`, `"lib": ["es2023", "DOM"]`.
- `vite.config.ts`: `pack: { dts: { tsgo: true }, exports: true }`; `test` block: coverage thresholds + `passWithNoTests: true` (vitest exits 1 on a test-less package, which would break `vp ready` during Phase 0) + `environment` node default (component tests use per-file happy-dom pragma). CSS lib build: `cssCodeSplit: false` so the stylesheet is one file.
- Root `vite.config.ts`: extend the `mantaq/*` rules override glob to include `packages/viz/src/core/**` for `no-console` + `no-throw`; **do not** enable `no-try-catch` in viz (context values are untrusted input; `formatValue`/getter handling and `buildVizGraph`'s catch of a throwing `buildGraph` are the sanctioned untrusted-value boundary). `no-explicit-any` already applies repo-wide.
- **The vision guard is core-only** — viz is exempt from export budget/impl ceiling, but determinism discipline and zero-cast discipline still apply by convention.
- `knip`: no unused deps/files; all new scripts (incl. `browser:*`, `test:browser`) are reachable from package.json so knip doesn't flag them; add any `stryker.vitest.config` to `knip.json` if one appears.

---

## 5. Repository layout

```
packages/viz/
├── package.json / vite.config.ts / tsconfig.json
├── src/
│   ├── index.ts                  # THE React public API (§3)
│   ├── core/                     # pure, framework-agnostic, deterministic
│   │   ├── graph-model.ts        #   buildVizGraph, VizGraph/VizNode/VizEdge/VizGroup, VizResult
│   │   ├── layout.ts             #   layoutGraph (flat dagre in v1)
│   │   ├── timeline.ts           #   Timeline, createTimeline (ring buffer, optional send-wrap)
│   │   ├── diff.ts               #   diffContext (circular-safe, undefined-vs-missing aware)
│   │   ├── format.ts             #   formatValue, formatTime, formatEventName, formatStatePath
│   │   └── index.ts              # THE core public API (§3)
│   ├── model/                    # React data layer
│   │   ├── viz-provider.tsx      #   VizProvider + useVizStore (one subscription, useSyncExternalStore)
│   │   ├── use-actor-model.ts    #   ActorModel, VizError normalization, rebuild-on-path-change
│   │   └── flow-adapter.ts       #   toFlowNodes / toFlowEdges (typed React Flow adapter)
│   ├── components/
│   │   ├── viz.tsx  state-graph.tsx  event-palette.tsx  context-inspector.tsx
│   │   ├── transition-timeline.tsx  actor-badge.tsx  error-banner.tsx
│   │   └── nodes/                #   mantaq-state.tsx, mantaq-group.tsx, mantaq-edge.tsx
│   ├── styles/
│   │   ├── tokens.css            #   --mtq-* design tokens, light + [data-theme="dark"]
│   │   ├── base.css              #   box-sizing reset only
│   │   ├── styles.css            #   entry: @import React Flow css + base + components (compiled to one file)
│   │   └── components/*.css      #   plain scoped CSS, mtq-* class names, token-only values
│   └── specs/                    # spec-first layer (§11) — one .md per component
├── tests/                        # vitest: *.test.ts, *.error.test.ts, *.property.test.ts
├── browser/                      # Playwright fixture harness (§9)
│   ├── vite.config.ts  index.html  playwright.config.ts
│   ├── src/ (main.tsx, router.tsx, host.tsx, global.css)
│   ├── fixtures/ (real/*.ts, synthetic/*.ts, fingerprints.json)
│   └── tests/*.spec.ts  (+ __snapshots__/linux committed, darwin/win32 gitignored)
└── docs/ (README.md + API.md generated from exports)
```

### CSS delivery contract (why plain CSS, not CSS Modules)

- Components reference stable class strings (`mtq-viz`, `mtq-node--active`) — deterministic in the DOM, greppable, and directly assertable in Playwright.
- `src/styles/styles.css` starts with `@import "@xyflow/react/dist/style.css";` then `tokens.css` → `base.css` → component CSS. The lib build (`cssCodeSplit: false`) emits one `dist/styles.css`.
- Consumers add one line: `import "@mantaq/viz/styles.css";` (same pattern React Flow itself uses). Docs demo and fixtures do this. The `sideEffects: ["*.css"]` flag stops bundlers from tree-shaking it.
- **React Flow canvas theming:** RF reads its own `--xy-*` variables (background, grid, edge stroke). `tokens.css` maps them under `.mtq-viz` scope, e.g. `--xy-edge-stroke: var(--mtq-graph-edge)`, `--xy-edge-stroke-selected: var(--mtq-accent)` — so "token-only" holds for the canvas too. `color-scheme: light|dark` is set in both theme blocks (native scrollbars/inputs).

---

## 6. Architecture: data flow

```
                 ┌─ buildVizGraph(actor) ─► VizGraph ──► layoutGraph ─► LayoutResult
actor            │   (rebuilt when snapshot.path changes;              (memoized on structural fingerprint)
                 │    edges depend on live state/context/clock)
                 │
   path change ─► rebuild edges (structure may change → re-layout only if node set changed)
   context-only ─► applyLive (flips isActive/isError flags; no rebuild)
   transition   ─► Timeline entries (append, ring buffer)
```

### 6.1 The model — `VizGraph`

Normalized, render-ready, derived from `@mantaq/traversal`'s `ActorGraph` + `snapshot()`. Key points (full types in the graph-model spec):

- `VizNode`: `{ id (traversal dot-path, as-is), label, kind: "state"|"initial"|"region-group", isActive, isFinal, isInitial, effects: VizEffect[], groupId, parentPath, payload?, source }`.
- `VizEdge`: `{ id, source, target, label, kind: "transition"|"effect"|"undetermined"|"initial", isActive, isInternal, contexts?, action? }`.
- **Undetermined edges are normalized to `target = source`** — a guard-rejected transition stays in its state. This is the fix for v1's phantom flash-in nodes (audit #12): no synthetic target nodes ever exist. `isUndetermined` is preserved as a flag so a genuine self-loop (`{state: same}`) and a guard-reject (`{}`) stay distinguishable (traversal sets `isUndetermined = !targetName`).
- **Effects become node badges, never edges.** The adapter filters `effect:` self-loops out of rendering and passes `effects` to the custom node component. Effect counts are computed **inside `buildVizGraph` by walking `actor.regions` recursively** (traversal emits one self-loop per state-with-effects, per actor; root `options.effects` doesn't cover region children; two same-named states in different regions have distinct ids — attribution is by node id, label collisions harmless). Badge/header counts: per-node count = number of effect fns on that state (from the recursive walk), deduped by `effect:<state>` label; header stats aggregate across the tree.
- `VizGroup` (region containers): derived by **recursively walking `actor.regions`** (nested regions → `outer.inner` prefixes) + id prefixes; root group id = `""`. **Carried in the model from day 1** so flat → nested rendering is an adapter choice, not a data-model rewrite. v1 renders flat; per-region layout is Phase 5+.
- `buildVizGraph(actor) -> { status: "ok", graph } | { status: "error", reason, message }` — **never returns an empty graph silently**. A thrown `buildGraph` (it rethrows handler errors) becomes a typed error the UI renders.
- **The graph is a function of live state.** `buildGraph` executes handlers with the live actor, and `onAny`/context-branching/`clock.now()`-branching handlers (checkout `back`, credit-check, cache) resolve different targets depending on where the machine is _now_. So the model is rebuilt when the active path changes (§6.4) — the edges you see are the edges that are true _right now_, and undetermined edges are annotated as sample-time facts ("no target resolved for X from Y"), never silently wrong.

### 6.2 React Flow adapter

- `toFlowNodes`/`toFlowEdges` → typed `Node<FlowNodeData, "mantaqState"|"mantaqGroup">` / `Edge<FlowEdgeData, "mantaqEdge">`.
- Fixed `initialWidth/initialHeight` on every node (kills React Flow's measure-flicker), deterministic positions from layout.
- **No inline styles for colors.** All state styling via CSS classes + `data-active`/`data-final`/`data-node-id`/`data-edge-state` attributes (the `data-node-id`/`data-edge-state` attrs are what the structural assertions read).
- React Flow `proOptions={{hideAttribution: false}}` (attribution stays — MIT requires it; don't hide it). RF CSS comes from the consumer's `@mantaq/viz/styles.css` import (§5).

### 6.3 Layout — `layoutGraph` (flat dagre in v1)

- **v1 primary: single flat dagre over all nodes** (dot-path labels, e.g. `connected.health.healthy`). Regions render flat, as the current actor design already does; group metadata exists in the model but isn't used for layout yet.
- Deterministic: constant node sizes, nodes/edges inserted in **sorted-id order** (dagre output depends on insertion order — unsorted = unstable layout, the v1 jank class). Sync, one call, no DOM reads, no `Math.random`.
- **Layout sanity invariants (property-tested in Phase 1):** all positions finite (no NaN/Infinity), no two nodes overlapping, all node boxes within the computed graph bounds, every edge endpoint references an existing node. A deterministic-but-broken layout (all-at-origin) must fail.
- Phase 5+ extension: per-region subgraphs (dagre per region, group box = child bbox + padding, root level with region mega-nodes, cross-region edges projected to group↔group), with elkjs layered as the escalation path.

### 6.4 Sync strategy (anti-jank + correctness — the honest model)

- **Rebuild on path change.** `useActorModel` calls `buildVizGraph` when `snapshot.path` (or `done`/`error`) changes — edges genuinely depend on live state, so this is the _correct_ model, not a perf shortcut. `buildGraph` is O(states × handlers) and runs only on transitions, never on render/scroll/hover.
- **Layout memoized on the structural fingerprint** — the sorted node-id set + sorted edge `(id, source, target)` triples. Positions stay stable across transitions (no re-layout jank); re-layout only when the structure actually changes.
- **`applyLive` for context-only changes** — when `snapshot.path` is unchanged (context write, `transitioned: false`), only `isActive`/`isError`/`edge.isActive` flags flip; unchanged objects keep identity so React Flow's prop diff is O(changed).
- **One subscription per actor, shared via `<VizProvider>` context + `useSyncExternalStore`** — no N subscriptions, no module-level WeakMap leaks, clean lifecycle. The store must **skip the seeded `change` callback** (`subscribers` replays `(seed, seed)` on subscribe) and must not depend on subscribers throwing.
- `fitView` only on mount / explicit user action (`refit()`), never per-update.
- Controlled React Flow props (`nodes`/`edges` + `onNodesChange`), not the internal store, because the data pipeline is pure and recomputable.

### 6.5 Timeline — deterministic recording

- Entries are a discriminated union: `transition` (event/from/to/transitioned/`t`/`seq`), `drain` (`change`/`error`: snapshot+prev+correlated transition chain), optional `send`.
- **Time** = `actor.clock.now()` captured at record time; **`seq`** = monotonic logical counter = the scrub axis. With VirtualClock both are deterministic; with RealClock `seq` is the replay axis and `t` is cosmetic. No `Date.now` anywhere in the record/render path.
- **Correlation** (the core API gap): transitions have no snapshot, changes have no event. The recorder pairs `on("transition")` with `on("change", (snap, prev))` — each drain entry carries the full transition chain since the previous drain. Cascades (N transitions → 1 change) render honestly as a chain, never faked snapshots (documented core limitation).
- **Unhandled events** are silent in core hooks — only intercepting `actor.send` can see them. `trackSends?: boolean` (default false) monkey-patches `actor.send` reversibly on attach/detach (documented: one send-tracking timeline per actor at a time). Default usage is 100% hook-based, zero actor mutation.
- **Ring buffer** (default 500): eviction drops oldest, scrub index clamps, eviction preserves logical position. Scrub is **visual-only** — `recover` is never called (no rewinding the machine).
- Errors are first-class `kind: "error"` entries with `reason` + human hint.

### 6.6 Context diff — `diffContext(prev, next)`

- Output: `{ changed: [{ path, kind: added|removed|changed, before?, after? }], unchangedCount }`, sorted by path. Deterministic.
- **Never silently drops values** (v1 audit #6 fix): functions → `ƒ name()`, symbols → `Symbol(desc)`, bigint → `123n`, Date → ISO, Map/Set → `Map(2)`, arrays → index-based walk, **circular refs detected** (ancestor stack, no throw, `[Circular]` badge), `undefined` vs missing distinguished, getter-throws → `[getter threw: …]` badge + continue.
- Depth cap (default 8) with collapse badge. `formatValue` never throws (whole body in try/catch → `"<unprintable>"`).

---

## 7. UI/UX specification

### 7.1 Composite layout (`<Viz>`, 1280×800)

```
┌─ header (44px) ───────────────────────────────────────────────────────┐
│ ● checkout   6 st · 4 ev · 2 rg · 1 fx          [fit] [theme]         │
│ ▲ error banner (32px, only on error)                     [dismiss ×]  │
├─ main (flex row) ─────────────────────────────────────────────────────┤
│ ┌─ graph canvas (960×606, fits parent)─┐ ┌─ inspector (320px fixed)─┐ │
│ │   states + active path accent,        │ │  ▾ Context (tree/diff)  │ │
│ │   effect badges ⏱, pan/zoom,          │ │  ▾ Events (palette)     │ │
│ │   selection ring, scrub dimming       │ │                         │ │
│ └───────────────────────────────────────┘ └─────────────────────────┘ │
├─ timeline strip (150px open / 32px collapsed) ────────────────────────┤
│ ▾ Transition trace · 3 of 12   [▶] [◀] [▶▶] [live ●]                 │
│ ├─┬─┬─┬─┬─┬─┬───┤  (segments: past / current accent / future 40%)    │
└───────────────────────────────────────────────────────────────────────┘
```

- Inspector fixed 320px; collapse chevrons per panel; container query `< 900px` stacks inspector below graph (`data-layout="narrow"`). No drag-resize (out of scope).
- Theme: explicit `theme` option, else inherit nearest `[data-theme]`, else `prefers-color-scheme`. Root renders resolved `data-theme` + `color-scheme`.

### 7.2 Component contract summary (full specs in `src/specs/*.md`, written in Phase 0)

Rules that apply to every component: **no `string`-typed props** (union literals only, ≤4 variants), **≤8 props**, **no `null` render for empty/error states**, **no dead controls** (every button wired or cut), **no new design token without updating `tokens.css`**.

| Component            | Props (essentials)                                                                | Finite states                                 | Key contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Viz`                | `actor`, `options?{header, defaultInspector, defaultTimeline, theme}`, `onError?` | ok / empty / error / done                     | wires scrub index + panel collapse; keyboard: `Space` play, `←/→` step, `f` fit, `0` live, `Esc` close popover. **Key guard:** root keydown handler ignores the event when `event.target` is a button/input/textarea/`[contenteditable]` or `event.defaultPrevented` (Space must not double-trigger a focused button).                                                                                                                                                                          |
| `StateGraph`         | `actor`, `interactive?`, `selectedId?/onSelect?`, `scrubIndex?`                   | ready / empty / error / dimmed-while-scrubbed | node states: default/active/selected/initial/final/dimmed/hover/focus/error; edge states: default/active/internal/undetermined/selected/dimmed; effect badge popover; **no node dragging**; nodes carry `data-node-id`, edges carry `data-edge-state` (for the structural gate).                                                                                                                                                                                                                |
| `EventPalette`       | `actor`, `variant? full\|compact`, `onDispatch?`                                  | ready / empty / done                          | groups: **Primary** (edges from active state, non-internal) / **Any** (from `options.transitions.Any`) / **Internal** (display-only chips, not buttons). **Payload contract:** payload-typed events are shown as disabled chips labeled `requires payload — not sendable (v1)`; only payload-free events are sendable (runtime can't detect payload-requiredness — `EventRef` erases the generic — so the palette plays it safe). `done` → all disabled + note. No hotkeys, no payload editing. |
| `ContextInspector`   | `actor`, `mode? current\|diff`, `defaultOpen?`                                    | ready / empty / error                         | tree role=a11y; renders every JS value type; diff mode uses `model.prev`; no edit-in-place.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `TransitionTimeline` | `actor`, `size? 100\|250\|500\|1000`, `onScrub?`                                  | empty / live / scrubbed                       | segmented scrubber + hidden range input (a11y/keyboard); play/pause/step/back-to-live; **never calls `recover`**.                                                                                                                                                                                                                                                                                                                                                                               |
| `ActorBadge`         | `actor`, `name?`, `showStats?`                                                    | running / error / done                        | status dot + `N states · N events · N effects · N regions`.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ErrorBanner`        | `error: VizError`, `onDismiss?`                                                   | visible / dismissed                           | `role="alert"` + `aria-live="assertive"`; reason chip, event, state; copy button for graph errors; no auto-dismiss.                                                                                                                                                                                                                                                                                                                                                                             |

`VizError` (the only error type): `{ kind: "graph", message } | { kind: "actor", reason: ErrorReason, eventType, state, message }`.

### 7.3 Design tokens (`tokens.css`)

Single file, `--mtq-` prefix, light values + `[data-theme="dark"]` overrides (both blocks set `color-scheme`). Consumer overrides any var; no raw colors/spacing anywhere else. React Flow's `--xy-*` vars are mapped to tokens under `.mtq-viz` scope.

Core set: surface (`--mtq-bg`, `--mtq-bg-raised`, `--mtq-bg-hover`), text (`--mtq-text`, `--mtq-text-muted`, `--mtq-text-on-accent`), border (`--mtq-border`, `--mtq-border-strong`), accent (`--mtq-accent`, `--mtq-accent-muted`), status (`--mtq-ok`, `--mtq-warn`, `--mtq-err`, each + `-bg` tint), graph (`--mtq-graph-node-*`, `--mtq-graph-edge-*` incl. active/internal/undetermined/label-bg), spacing scale (`--mtq-sp-1..6`), radii (`--mtq-radius-sm/md/lg/full`), fonts (sans + mono), font sizes (11/12/13px tool density), durations (100/200/400ms), z-index, shadow.

Diff colors **reuse** status tokens (no dedicated diff palette). Final nodes reuse a single `--mtq-graph-node-final` token. Fonts: `--mtq-font-mono` reserved for event names/state ids/context values — the "identifier" style signal.

### 7.4 Empty & error states (the "never lie" contract)

1. **0 nodes** → EmptyState card: `"No states to visualize"` + why-bullets (no `states` in options / no initial declared / empty regions). Not a blank canvas.
2. **`buildVizGraph` fails** → graph area keeps last-good graph (if any) at 30% under an error card with `copy error`; if never succeeded, the card replaces the canvas. `onError` fires once per new error.
3. **Actor in `__error`** → header ErrorBanner (reason chip + event + state) + red-tinted active node + timeline `error` entry. Graph stays visible and the palette stays enabled — you debug the failed machine by driving it.
4. **Guard-rejected / no-target transition** → dashed-red undetermined self-loop edge + tooltip `"no target resolved for EVENT"`. Timeline entry `transitioned: false`.
5. **Unhandled context values** → badges/placeholders (Section 6.6). Never dropped, never `[object Object]`.

### 7.5 Progressive disclosure

Visible by default: graph + active path, ActorBadge stats, Primary events, top-level context keys, last 8 timeline segments. Behind interaction: Any/Internal groups, context subtrees + diff, older timeline, effect details, error detail. **Complexity renders as counts, never as content** (region count, effect count, undetermined count).

### 7.6 Visual spec (anti-ugliness beyond tokens)

Tokens prevent off-scale values; this paragraph defines the rhythm so an agent inherits coherence, not just variables.

- **Type-role hierarchy:** state node label = `--mtq-font-base` sans, weight 600; edge label = `--mtq-font-size-xs` mono on a `--mtq-graph-edge-label-bg` chip; badge = `--mtq-font-size-xs`; panel headers = `--mtq-font-size-sm` weight 600 uppercase-ish tracking; event buttons = `--mtq-font-size-xs` mono. One hierarchy, no improvisation.
- **Spacing mapping:** `--mtq-sp-1` micro (chip padding), `--mtq-sp-2` compact gaps (button rows, badge stacks), `--mtq-sp-3` panel padding, `--mtq-sp-4` section rhythm (panel header → content), `--mtq-sp-6` empty-state block. Never sp-4 for a gap between buttons.
- **Node anatomy (must match this, not "a card with a border"):** rounded `--mtq-radius-md`, 1px `--mtq-border` stroke, `--mtq-bg-raised` fill, label centered, effect badges top-right as small `--mtq-radius-full` chips, active = accent fill + `--mtq-text-on-accent`. Final = single `--mtq-graph-node-final` outer ring. Initial = hollow accent ring. No shadows, no gradients, no extra decorations.
- **Anchor baselines:** 2–3 human-approved screenshots (checkout graph light+dark, EventPalette, TransitionTimeline) are committed in Phase 1 as the visual reference the golden gate approximates; reviewed again at the Phase 4 boundary.

---

## 8. Determinism

- **No `Date.now` / `Math.random` / `performance.now` in `src/core`** (the render/record/layout path). Only time source: injected `actor.clock.now()`. Timeline `seq` is the scrub/replay axis; `t` (clock time) is display.
- **Graph determinism boundary:** the graph is a function of (actor definition, live state at build time, sampleContext, clock). Fixtures **pre-script fully before mount**, so the build-time state is fixed and the baseline is a pure function of the script. Same actor + VirtualClock + same scripted sends → identical graph, layout, screenshots, timeline.
- dagre determinism: sorted insertion, fixed node dims.
- Playwright screenshots additionally pin: `page.clock.setFixedTime`, animations disabled, bundled fonts, fixed viewport/DSF/locale/timezone, Linux-only baselines.
- Fixture copies neutralize upstream nondeterminism: `Math.random()` → constant, `Date.now()` → `clock.now()` (auth + credit-check examples have both).

---

## 9. QA: fixture gallery + golden gate + structural assertions (the anti-"plain terrible" machine check)

### 9.1 The harness (`packages/viz/browser/`)

A small Vite app: fixture router (`?fixture=id&theme=dark`), a `FixtureHost` that builds a fresh actor (VirtualClock), pre-scripts a deterministic event sequence _before_ mount, mounts the component under test, exposes `window.__viz` (`send`, `advance`, `getPath`, `getHistoryLen`) for Playwright, and sets a `flow-ready` data-testid only when **all** hold: fonts loaded (`document.fonts.status === "loaded"`), React Flow initialized, every node `measured`, rendered counts match the fixture's declared counts, `actor.settled()` resolved when the fixture declares `settled: true` (mid-flight fixtures declare `settled: false` and expected `pendingTimers()` count), 2 RAF flushes.

**Fixtures are pinned copies, not imports** — `packages/examples` is not importable (factories live inside `.actor.test.ts`, module-private, no exports map). Each fixture file header notes source file + factory + `FIXTURE_VERSION`. **Drift guard:** every fixture actor is run through `buildVizGraph` by a CI script that asserts the id-set + node/edge counts against a committed `browser/fixtures/fingerprints.json` — if example tests refactor in a way that changes a fixture's graph, CI fails loudly instead of baselines silently going stale. (`scripts/docs-check.mjs` only pins the checkout narrative; it does **not** guard viz fixtures — don't rely on it.)

### 9.2 Fixture matrix

**Fixture declares its own shots** (graph-light, graph-dark, viz, palette, inspector, timeline + interactions), so the total is _derived from code_, not a hand-wave. Rule: every fixture gets graph-light + graph-dark + (for real actors) full `Viz`; edge cases additionally exercise the component they stress. Approximate total ≈ 65 shots across 25 fixtures.

Real actors (13 example files → 13 fixtures; each pre-scripts a mid-flight state where meaningful):

| Fixture            | Source                         | Notes                                                                           |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------- |
| checkout           | `createCheckoutActor`          | canonical; pre-script to `submitting` for context-diff shot                     |
| auth               | `createAuthActor`              | neutralize `Math.random`/`Date.now`                                             |
| saga               | `createSagaActor`              | 9 states, 12 internal, 6 effects; mid-flight + compensating states              |
| credit-check       | `createCreditCheckActor`       | neutralize nondeterminism                                                       |
| connection-manager | `createConnectionManager`      | region + backoff                                                                |
| websocket          | `createWsActor`                | retry cycle                                                                     |
| animation-ui       | `createAnimationActor`         | 4 regions live                                                                  |
| cache              | `createCacheActor(capacity 2)` | Map context in inspector                                                        |
| game-character     | `createCharacter`              | guards + region                                                                 |
| undo-redo          | `createEditorActor`            | best timeline fixture (8 inputs)                                                |
| event-sourcing     | `createAccountAggregate`       | outputs                                                                         |
| requester          | `createRequester`              | ActorMap dynamic children (render as states; ActorMap depth is a v1 limitation) |
| actor-map          | parent + `createWorker`        | keyed workers                                                                   |

Synthetic edge cases (each asserts a real render, not a blank canvas): `empty` (0 states), `single`, `self-loop`, `traffic-light` (cyclic, 7 cycles), `chain-50` (50 states), `dense-60` (60 nodes), `all-final`, `__error` (forced error + banner + inspector), `long-labels` (100+ chars), `rich-context` (functions/symbols/arrays/circular — inspector badges), `done`, `light-toggle`.

Timeline-focused (on undo-redo + traffic-light): 30-transition run, scrubbed-to-middle (past/future dimmed + back-to-live), playing. Inspector-focused: context diff visible, error reason surfaced.

### 9.3 Interaction tests (behavior, not pixels)

Palette click → active node updates; timeline step click → inspector shows that snapshot + future dimmed; unhandled send → error banner + no console crash; fit-view → all nodes in viewport; panel collapse toggle; keyboard arrows step timeline (**with a palette button focused** to prove the Space/key guard); empty fixture → empty-state text + `data-node-count="0"`; `advance(500)` → active node + edge highlight + timeline grew; play/pause toggles.

### 9.4 Playwright config + CI

- `browser/playwright.config.ts`: chromium only, `workers: 1`, `retries: CI ? 1 : 0`, viewport 1280×800, DSF 1, `en-US`/UTC, `reducedMotion: "reduce"`, `toHaveScreenshot{ animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.002, threshold: 0.2 }`, snapshot path `{testDir}/__snapshots__/{platform}/...`.
- **webServer command uses `vp`, not `vite`** — this repo's `vite` catalog entry is the vite-plus fork with **no `bin`**, so the only available CLIs are `vp build` / `vp preview`. Command: `vp build --config browser/vite.config.ts && vp preview --config browser/vite.config.ts --port 4173 --strictPort` (wired as the `serve:test` script; `reuseExistingServer: !CI`, `timeout: 120_000`).
- **Baselines only ever generated on Linux** (CI is `ubuntu-latest`). `__snapshots__/darwin` + `/win32` gitignored — a macOS run diffs locally but can never contaminate the baseline. Update flow: a `workflow_dispatch` GitHub workflow runs `--update-snapshots` on ubuntu and commits changed PNGs back to the branch.
- New CI job `viz-browser` (sibling of `ready`): checkout → setup-vp → `vp install` → `playwright install --with-deps chromium` → `pnpm --filter @mantaq/viz run test:browser` → upload test-results/playwright-report artifacts on failure.
- `.gitignore` additions: `packages/viz/browser/test-results/`, `packages/viz/browser/playwright-report/`, `packages/viz/browser/tests/__snapshots__/darwin/`, `/win32/`. `__snapshots__/linux/*.png` stays committed.
- Coexists with `vp ready`: viz still passes `vp check`, `vp test` (node + happy-dom), `vp pack`, `knip`. The browser job is separate.

### 9.5 Structural assertions (the semantic gate — run before every screenshot)

A golden enshrines whatever renders; it can't tell "right" from "plausible". So every spec asserts _before_ `toHaveScreenshot`:

1. **Active-path truth:** `[data-active]` node id set equals the live `snapshot.path` (via `window.__viz.getPath()`), flattened across regions. Error fixture: no `data-active` node + error banner present.
2. **Node-set truth:** rendered node-id set equals the fixture's declared set (`data-node-id` attrs); counts match.
3. **Edge validity:** every rendered edge's source/target references an existing node; undetermined edges render as self-loops (source === target) with `data-edge-state="undetermined"`.
4. **Layout sanity:** no two node boxes overlap (getBoundingClientRect), all nodes inside the viewport after fit, no NaN/undefined positions.
5. **Interaction wiring:** every palette button click changes the active path or is a disabled `requires payload` chip (no dead buttons).

This converts "baseline enshrines the agent's output" into "baseline must match the spec" — the strongest single guardrail in the plan.

### 9.6 Repo test taxonomy

- `tests/*.test.ts` — features (incl. the "every §3 export resolves through the package path" contract test, from Phase 1).
- `tests/*.error.test.ts` — failure paths (buildGraph throw, unhandled event, circular context).
- `tests/*.property.test.ts` — PBT with `@mantaq/pbt` (`runProperty`, `MANTAQ_SEED` pinned): timeline invariants (seq strictly increasing, t non-decreasing, ring eviction + clamp, drain-correlation equality, send attribution, detach no-op, deterministic replay), diff invariants (reflexivity, flip-symmetry, no duplicate paths, coverage, circular-safety, depth cap, determinism), **layout invariants (no overlap, in-bounds, finite positions, edge endpoints valid)**, formatValue (never throws, bounded, terminates on circular).
- No stryker config for viz initially (property tests still run under `vp test`; mutation-scoring React/DOM code in node env is low value). If added later, repo convention applies (`*.property.test.ts` + `*.mutation.test.ts` only).

---

## 10. Build phases (execution order; each has exit criteria)

### Phase 0 — Foundations & bootstrapping (2 days)

- Package skeleton (§4 deps/scripts/exports/tsconfig/vite.config with `passWithNoTests`), `styles/tokens.css` + `base.css` (the full token table §7.3), `specs/*.md` (the written component contracts §7.2 + §7.6 visual spec), `CONTRIBUTING.md` "UI coding rules" (§11).
- A stub browser page (`index.html` + `main.tsx` rendering one hardcoded node) so the Playwright smoke spec has a render target that survives into Phase 1.
- Lint/CI wiring: root vite.config override glob (`no-console`/`no-throw` for `packages/viz/src/core`), CI `viz-browser` job + smoke spec, `.gitignore`, knip, `AGENTS.md` viz section (rules + commands).
- **Bootstrapping (exact, for the executing agent):** `git fetch origin && git checkout -b feat/viz-v2 origin/main` → `vp install` → add `react`/`react-dom`/`@playwright/test` to the workspace catalog → `pnpm --filter @mantaq/viz add …` (updates lockfile) → create skeleton files in this order: `package.json` → `tsconfig.json` → `vite.config.ts` → `src/index.ts` stub (empty exports map) → `tokens.css` → `specs/*` → stub browser page → CI job.
- **Exit criteria:** empty package passes `vp ready` (check/guard/knip/test/build); Playwright smoke spec green; a **Phase 0 ralph-loop review gate** signs off the specs (explicit owner, not implicit).

### Phase 1 — Vertical slice: graph renders (5 days)

- Harness (host, router, `flow-ready`, `window.__viz`), pinned fixtures for checkout + traffic-light, `fingerprints.json` + CI drift guard.
- `buildVizGraph` (flat) + `layoutGraph` (flat dagre) + flow adapter + `VizProvider`/`useActorModel` (rebuild-on-path-change, structural-fingerprint layout memo, `applyLive`) + `StateGraph` + `ActorBadge` + `ErrorBanner` + styles.
- First goldens + **structural assertions** (§9.5) for the two fixtures, light+dark. Anchor baselines (§7.6) reviewed by a human.
- "Every §3 export resolves through the package path" contract test. Layout sanity property tests.
- **Exit criteria:** `vp ready` green; golden + structural gate green for checkout and traffic-light; layout PBT invariants pass; a human reviews the two anchor screenshots and signs off the visual direction before breadth begins.

### Phase 2 — Fixture matrix breadth (3-4 days)

- Remaining real actors + synthetic edge cases + timeline/inspector fixtures; full golden suite + structural assertions; graph interaction tests (§9.3 graph rows); determinism audit (grep `Date.now|Math.random|performance.now|throw` in `src/core` — zero).
- **Exit criteria:** all 25 fixtures render with correct structural assertions; golden gate fully green on CI; `dense-60`/`chain-50` render without jank or overlap; a human reviews the full light+dark gallery and signs off.

### Phase 3 — Inspector & palette (4 days)

- `diffContext` + `formatValue` + `formatTime`/`formatEventName` (pure core + PBT), `ContextInspector` (tree + diff), `EventPalette` (payload contract §7.2), their goldens + interaction tests (palette click, unhandled event, diff X1/X2, `rich-context` inspector).
- **Exit criteria:** inspector/palette goldens + interactions green; `rich-context` renders every value type as a badge, never a drop; palette chips never fire payload-typed events.

### Phase 4 — Composite & timeline (5-6 days)

- `Timeline` core (ring buffer, `trackSends`, correlation) + PBT; `TransitionTimeline` (segmented scrubber, play/step/back-to-live, Space/key guard); `Viz` composite (header, panels, keyboard, theme, narrow layout); scrub↔graph↔inspector wiring; timeline-focused + composite goldens; `int-keyboard` with focused button proves the key guard.
- **Exit criteria:** full golden + interaction suite green; scrub never calls `recover`; `int-timeline-step`/`int-keyboard`/`int-play-pause` pass; dark-mode + narrow-layout shots pass; second human review of the full composite.

### Phase 5 — Ship (3-5 days)

- Full type-level API contract tests (`expectTypeOf` per §3 export). README/API generated from or verified against exports.
- Docs: `apps/docs` gains `@astrojs/react` (version matched to Astro 7), `guides/viz.mdx` + `reference/viz.mdx`, live islands (`client:load`) rendering fixture actors **passed as props** (no `el.actor = actor` DOM hack). Extend `scripts/docs-check.mjs` `PACKAGE_INDEX` so docs imports of `@mantaq/viz`/`@mantaq/viz/core` are gate-checked. `@mantaq/viz` + `react` + `react-dom` added to `apps/docs` deps.
- Theme/shortcuts documented as implemented only. No fiction (§1 #6).
- **Exit criteria:** docs build green under `vp run -r build`; API contract tests green; `vp ready` + browser suite green on CI; package publishes via existing release flow.

### Phase 5+ (explicitly not v1)

Region container nesting + per-region layout (model already carries groups; elkjs escalation path), ActorMap dynamic-child rendering, dark/light polish pass, context payload editing + core `EventRef` runtime payload marker (unlocks a fuller palette), static/SVG export, web-component wrapper.

---

## 11. AI-buildability guardrails (how we stop AI from breaking the UI)

Five enforcement layers. Each catches what the layer below can't.

```
L0 SPEC/contract   → src/specs/*.md — finite props, finite states, don'ts. Human-written first, reviewed at Phase 0/2/4 gates.
L1 TYPES           → union-literal props, discriminated-union data, assertNever; no-explicit-any error.
L2 FIXTURES        → the browser gallery — agents SEE breakage in dev (every state of every component has a fixture).
L3 GOLDENS +       → Playwright baselines + structural assertions — "looks right" AND "is right" are failing builds.
   STRUCTURAL
L4 LINT + RULES    → oxlint gates + AGENTS.md "UI coding rules" (below).
```

### UI coding rules (paste into `AGENTS.md` / viz `CONTRIBUTING.md`)

1. **Spec first.** No component code before its `src/specs/<name>.md` exists and lists props, states, tokens, don'ts. Never invent a prop beyond the spec.
2. **Tokens only.** Every color/spacing/radius/font from `tokens.css`. Zero raw hex/rgb, zero inline `style` for color/spacing/font, zero Tailwind-style arbitrary values. New token? Update `tokens.css` + the token table first.
3. **Every state renders.** default, hover, focus-visible, disabled, empty, error, selected. Never `return null`/blank for a defined state — the fixture for that state exists and will be golden + structurally asserted.
4. **Data is a discriminated union**, never boolean flags. Exhaustive `switch` + `assertNever`. If a state can't exist, it must not compile.
5. **No dead controls.** Every rendered button/tab/chip has a wired, tested handler. No `disabled: true` without reason. No TODO/FIXME in shipped tree. Internal event chips are spans, not fake buttons.
6. **Hooks:** no async `useEffect`, no effect without cleanup, never suppress `react-hooks/*` lint.
7. **Semantic HTML + a11y:** native `<button>`, aria-labels on icon buttons, focus ring via `:focus-visible` + token, keyboard contract from the spec (with the button-focus guard). Axe runs in CI on changed screens (Phase 2+).
8. **Errors surface.** No `console.*` in library code; errors flow via `VizError`/`onError`. Never swallow a handler error into a blank canvas.
9. **Motion is token-only** and honors `prefers-reduced-motion` (golden tests won't stabilize otherwise).
10. **Before done:** typecheck + lint + open the fixture gallery at 1280px and 800px wide, verify empty/error states, then run the golden + structural suite. If a requirement can't be met with existing tokens/components, write `[DS-INCONSISTENCY]` in the code rather than silently bypassing.

### Known AI-UI failure modes → guardrail (top ones)

| Failure                                                | Guardrail                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Hardcoded colors / off-scale spacing (the #1)          | L0 tokens + L1 no inline styles + L4 lint                                       |
| Missing empty/error/loading states (60-92% of AI UIs)  | L0 finite-state model + L2 fixture per state + L3 golden per state              |
| Dead buttons / unhandled actions                       | L0 interaction contract + L3 interaction tests (int-*)                          |
| Untyped/`any` props                                    | L1 strict + repo-wide `no-explicit-any` error                                   |
| Boolean-flag async state (8 combos, 3 real)            | L1 discriminated unions + `assertNever`                                         |
| Async `useEffect` / missing cleanup / React 19 crashes | L4 hooks lint as error, no suppressions                                         |
| `div onClick` / missing a11y                           | L0 a11y contract + L4 jsx-a11y + axe in CI                                      |
| Layout overflow at real widths                         | L3 golden at 1280 + narrow; container-query fixtures                            |
| Blank/undrawn canvas, nondeterministic render          | L2 fixture per data state + L3 deterministic goldens + L3 structural assertions |
| Stale/deprecated APIs                                  | L0 pinned versions + import paths in AGENTS.md                                  |

---

## 12. Risks & mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp pack` (tsgo dts) + React/.tsx types misbehave                                          | React Flow/React ship first-party dts; verify in Phase 0 with a 10-line component before building anything. If tsgo chokes, fall back to `dts: {}` default (build still ships types).                            |
| `buildGraph` executes user handlers (side effects) on every mount _and_ every state change | Runs only on transitions (path change), never on render. Browser-safe, non-mutating (context writes dropped). Fixtures pre-script before mount so goldens are deterministic. Documented.                         |
| Graph edges change with live state → "wrong edge" bugs                                     | Accepted and fixed by design: rebuild-on-path-change IS the correct model (§6.4). The layout stays stable via structural-fingerprint memo. Undetermined edges are sample-time facts with tooltips, never silent. |
| Screenshot baselines churn from font/OS variance                                           | Bundled fontsource woff2, Linux-only baselines, fixed viewport, `{platform}` path + gitignore, `settled()` gating.                                                                                               |
| Vitest happy-dom + React Flow component tests flake                                        | Component tests stay minimal (behavior of chrome), Playwright owns canvas rendering. Tiny happy-dom shim for `DOMMatrix` allowed in a setup file.                                                                |
| React peer dep conflicts with repo "no peerDeps" convention                                | Deliberate, correct deviation for a React library; peer range `^19`; docs demo uses React 19.                                                                                                                    |
| Adding `@astrojs/react` breaks docs build (was a v1 killer)                                | Phase 5 only; `vp run -r build` gate + Astro client islands; demo wrapper passes actor as prop (no DOM hack); docs-check `PACKAGE_INDEX` extended.                                                               |
| First-run baselines enshrine an agent's plausible-but-wrong render                         | Structural assertions run before every screenshot (§9.5) — active path, node set, edge validity, layout sanity — so baselines must match the spec, not just exist. Human reviews anchor baselines at Phase 1.    |
| Scope creep (region nesting, export, editing) re-creates the monolith                      | §2 non-goals + §10 exit criteria; new features must clear "can it be golden + structurally tested?"                                                                                                              |
| LLM agents drift from spec                                                                 | L2 fixtures make drift visible in dev; L3 goldens + structural assertions fail CI; explicit review gates at Phase 0/1/2/4.                                                                                       |

## 13. Open decisions (resolve during Phase 0-1, low risk)

1. `@mantaq/viz/core` as a package subpath vs separate package — **decided: subpath** (one repo package, two entries). Revisit only if core outgrows the UI.
2. Whether `Timeline` should live in `@mantaq/traversal` instead — **decided: viz owns it** (traversal's `History`/`instrument` are test-oriented, wall-clock-based; viz needs a clock-aware recorder; avoid touching traversal's contract).
3. Effect badge click behavior — **decided: popover with `effect:<state>` + count**; deepen when effects gain metadata (future core work).
4. `__error` visual: red banner + tinted node + no phantom node — **decided** (§7.4).
5. Whether to expose `useGraph`/`useTimeline` hooks individually — **decided: only `useActorModel` public in v1**; hooks are internal, components self-sufficient from the `actor` prop.
6. Palette and payload-typed events — **decided:** palette sends only payload-free events; payload-typed events render as disabled `requires payload` chips. Rationale: `EventRef` erases the payload generic at runtime, so no API can detect payload-requiredness; firing empty payloads would corrupt context or trip `__error`. A Phase 5+ core extension (runtime payload marker on `EventRef`) unlocks a JSON payload editor in the palette.
7. `buildGraph`-based graph rebuilding on every path change vs a "structure sampled once" model — **decided: rebuild-on-path-change** (§6.4). Cost is bounded (only on transitions); correctness is what the debugger is for.
