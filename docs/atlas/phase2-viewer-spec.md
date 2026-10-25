# Atlas Phase 2: viewer spec (to build in a separate session)

Input: one JSON file matching `@mantaq/atlas` schema v1 (`packages/atlas/src/schema.ts`). No import of Mantaq runtime. The viewer must work from the JSON alone.

## Scope

Static page, loads a document (file picker + `?src=` URL). No firing transitions, no live actors, no editing. Reason: `viz` died on live-actor sync complexity.

## Must render

- One machine at a time; switcher if `machines.length > 1`.
- States as nodes. Group states by `region` (null = root) in labeled containers. Mark `initial` (entry arrow from `initial` state) and `final` (double border).
- Edges from `edges[]`, drawn `from` → `to`, labeled with `event`.
  - `kind: "effect"`: self-loop, visually quiet, labeled with effect name.
  - `kind: "initial"`: do not draw as event edge; use for entry marker.
  - `to: null`: **undetermined**. Draw a dashed stub leaving `from` ending in a "?" node. Never guess a target.
  - Multiple edges between same pair: separate and readable, not overlapping.
- Event `internal: true` visually distinct from inputs.

## Interaction

- Click edge → side panel: source state, event (+ internal flag), target (or "undetermined"), `emits`, `contexts`, coverage hits, `explanation` (null in v1: show "not analyzed").
- Click state → panel: id, region, flags, visit hits, incoming/outgoing edges (click-through).
- Hover highlights an edge and its endpoints.

## Coverage overlay

- `coverage: null` → no run supplied; hide the toggle.
- `hits === 0` → unreached: dimmed + dashed. `hits > 0` → normal, hit count in panel.
- Coverage must not be encoded by color alone (dash + opacity + legend).

## Explicit honesty rules

- Show a banner: "Edges come from synthetic probing; payload-dependent branches may be missing." (Phase 0 limitation 2.)
- Unknown is rendered as unknown. No inferred labels.

## Layout / tech guidance

- dagre (layered) is enough for layout; SVG rendering, hand-rolled or lit-html. Skip X6.
- Dark/light via CSS variables. Keyboard: edges/states focusable.
- Must handle the three examples (checkout 6 states / 14 edges; auth; saga) without manual positioning.

## Acceptance

Open checkout JSON: all states and edges visible, `back` edges show as undetermined stubs, click any edge shows source/event/target, unreached edges (with a coverage run) look different, no console errors.

## Test approach

Playwright screenshot goldens were flaky in `viz` (text AA churn). Prefer DOM assertions (edge/state counts, panel text); at most a few screenshots.
