# Visualizer Testing Guide (for LLMs)

## Quick Start

```bash
cd packages/visualizer
vp install        # install deps
vp dev            # dev server at http://localhost:5174
vp test           # run 663 unit tests (Vitest/jsdom)
vp check          # format + lint + typecheck
```

## Test Files (21)

| File                         | Focus                                                   | Tests |
| ---------------------------- | ------------------------------------------------------- | ----- |
| `accessibility.test.ts`      | ARIA attributes, keyboard navigation, screen reader     | 50+   |
| `animation-toggle.test.ts`   | Animation enable/disable, speed control, reduced motion | 20+   |
| `components.test.ts`         | Core Lit components: state-node, edge, actor-graph      | 150+  |
| `error-handling.test.ts`     | Error scenarios, null safety, retry logic               | 25+   |
| `export.test.ts`             | SVG/PNG export, URL sharing, graph state serialization  | 40+   |
| `filter-controls.test.ts`    | Status filtering (all/active/final/inactive)            | 20+   |
| `focus-cycling.test.ts`      | Keyboard focus cycling between nodes                    | 15+   |
| `go-to-dialog.test.ts`       | Ctrl+G go-to-node dialog, fuzzy search                  | 25+   |
| `graph.test.ts`              | Actor snapshot → graph data conversion                  | 20+   |
| `history.test.ts`            | Transition history, replay, export, clear               | 40+   |
| `integration.test.ts`        | End-to-end store → layout → render flow                 | 20+   |
| `layout-options.test.ts`     | Layout algorithms, edge routing, auto-size              | 30+   |
| `layout.test.ts`             | ELK.js layout computation                               | 20+   |
| `search-bar.test.ts`         | Fuzzy search, result count, clear, input events         | 25+   |
| `shortcut-overlay.test.ts`   | Keyboard shortcut overlay display                       | 25+   |
| `shortcut-registry.test.ts`  | Shortcut definitions, matching, customization           | 30+   |
| `store.test.ts`              | Nanostores: zoom, pan, theme, animation, history        | 60+   |
| `styles-and-exports.test.ts` | CSS custom properties, barrel exports                   | 15+   |
| `theme-toggle.test.ts`       | Theme cycling, localStorage persistence                 | 20+   |
| `timer-indicator.test.ts`    | Timer display, pause/resume/cancel controls             | 25+   |
| `timer.test.ts`              | VirtualClock integration, timer extraction              | 25+   |

## Architecture (60s)

```
Actor (@mantaq/core)
  ↓ buildGraph()
ActorGraph (nodes[], edges[])
  ↓ computeLayout() via ELK.js
LayoutResult (nodes with x/y, edges with SVG path strings)
  ↓ nanostores ($graph, $layout, $zoom, $pan, $searchQuery, $filterStatus, ...)
<actor-graph> Lit component
  ↓
<state-node> SVG rect + text per node
<edge-path> SVG path + arrow per edge
<minimap-component> Canvas overview with pan/zoom navigation
<search-bar> Fuzzy node search
<filter-controls> Node status filter (all/active/final/inactive)
<history-panel> Transition history with replay
<node-details-panel> Selected node details (context, transitions, timers)
<theme-toggle> Light/dark/system/high-contrast toggle
<animation-toggle> Animation enable/speed control
<timer-indicator> Running timer display with pause/cancel
```

**Data flow:** Actor change → `setActor(actor)` → rebuild graph → compute layout → stores update → Lit re-renders

**Key files:**

- `src/graph.ts` — actor snapshot → graph data
- `src/layout.ts` — graph data → ELK.js positions
- `src/graph-store.ts` — all state atoms (stores, actions, theme, search, filter, history, animation, errors)
- `src/components/actor-graph.ts` — main container (pan/zoom/kbd)
- `src/components/state-node.ts` — single node SVG
- `src/components/edge.ts` — single edge SVG
- `src/components/minimap.ts` — canvas minimap with drag-to-pan
- `src/components/search-bar.ts` — fuzzy search input
- `src/components/filter-controls.ts` — status filter buttons
- `src/components/history-panel.ts` — transition history + replay
- `src/components/node-details-panel.ts` — node details (context/transitions/timers)
- `src/components/theme-toggle.ts` — theme cycle button
- `src/components/animation-toggle.ts` — animation toggle + speed
- `src/components/timer-indicator.ts` — timer badge with controls
- `src/types.ts` — shared type definitions
- `dev/main.ts` — test harness (workflow actor)
- `dev/index.html` — test page at `/dev/`

---

## Testing with Playwright

No Playwright installed. Add in `devDependencies`:

```bash
cd packages/visualizer
vp add -D @playwright/test
npx playwright install chromium
```

Create `tests/e2e/` directory for Playwright scripts.

### Page URL

```
http://localhost:5174/dev/
```

Server from `vp dev` (port 5174).

### Key DOM Selectors

```
#buttons > button               event buttons (START, FINISH, APPROVE, ...)
#buttons > button.effect-btn    effect button "work timeout (4s)"
#layout-controls > button       layout presets (RIGHT, DOWN, ...)
#elk-controls > button          ELK option toggles
#current-state                  state label ("State: idling")
actor-graph                     main graph component
actor-graph .container          pan/zoom container
actor-graph state-node          each state node (inside shadow DOM)
actor-graph edge-path           each edge (inside shadow DOM)
search-bar                      search input component
search-bar .search-input        the actual input element
search-bar .result-count        match count display
search-bar .clear-btn           clear search button
filter-controls                 filter buttons group
filter-controls .filter-btn     individual filter (all/active/final/inactive)
filter-controls .filter-btn.active  currently active filter
history-panel                   transition history panel
history-panel .history-entry    individual history row
history-panel .history-entry.active  currently selected entry
history-panel .replay-btn       prev/next replay buttons
history-panel .action-btn       export/clear buttons
node-details-panel              selected node details
node-details-panel .panel       the panel container
node-details-panel .panel.open  panel when visible
node-details-panel .badge-active  active status badge
node-details-panel .badge-final   final status badge
node-details-panel .context-block context data display
node-details-panel .transition-item individual transition row
node-details-panel .guard-tag   guard condition tag
node-details-panel .action-tag  action tag
node-details-panel .close-btn   close panel button
theme-toggle                    theme cycle button
theme-toggle .theme-btn         the clickable button
theme-toggle[data-mode="dark"]  when dark theme active
animation-toggle                animation controls
animation-toggle .anim-btn      enable/disable button
animation-toggle .speed-btn     speed option (0.5x, 1x, 2x, 4x)
animation-toggle .speed-btn.active  current speed
timer-indicator                 timer badge
timer-indicator .timer-badge    the badge container
timer-indicator .timer-progress progress bar track
timer-indicator .timer-progress-bar  the fill bar
timer-indicator .timer-btn[data-action="pause"]  pause button
timer-indicator .timer-btn[data-action="resume"] resume button
timer-indicator .timer-btn[data-action="cancel"] cancel button
minimap-component               canvas minimap
minimap-component .minimap-canvas  the canvas element
```

### Interacting with Event Buttons

```ts
// Send START event
await page.click("#buttons >> text=START");

// Verify state changed
await expect(page.locator("#current-state")).toHaveText("State: working");
```

### Interacting with Effect Button

Only visible when `working` active.

```ts
await page.click("#buttons >> text=START");
await page.click(".effect-btn >> text=work timeout");
await expect(page.locator("#current-state")).toHaveText("State: timeout");
```

### Interacting with Layout Presets

```ts
await page.click("#layout-controls >> text='→ RIGHT'");
await page.click("#layout-controls >> text='↓ DOWN'");
```

### Interacting with ELK Options

Each elk button cycles: unset → val1 → val2 → ... → unset.

```ts
// Toggle modelOrder to NODES_AND_EDGES
await page.click("#elk-controls >> text=modelOrder:_");
await expect(page.locator("#elk-controls >> text=modelOrder:NODES_AND_EDGES")).toBeVisible();
```

### Accessing Shadow DOM (actor-graph)

Components use Lit shadow DOM. Access internals via `page.locator('actor-graph').shadow()`.

```ts
const graph = page.locator("actor-graph");
const nodes = graph.shadow().locator("state-node");
const edges = graph.shadow().locator("edge-path");
await expect(nodes).toHaveCount(6);
```

### Pan and Zoom (mouse events)

```ts
const container = graph.shadow().locator(".container");

// Pan: drag
await container.dispatchEvent("mousedown", { clientX: 100, clientY: 100 });
await page.mouse.move(200, 150);
await page.mouse.up();

// Zoom: scroll wheel
await container.dispatchEvent("wheel", { deltaY: 120 }); // zoom out
await container.dispatchEvent("wheel", { deltaY: -120 }); // zoom in
```

### Keyboard Shortcuts

Send keys to `actor-graph` shadow `.container`:

```ts
const container = graph.shadow().locator(".container");
await container.press("+"); // zoom in
await container.press("-"); // zoom out
await container.press("0"); // reset view
await container.press("f"); // zoom to fit
await container.press("Escape"); // deselect node
await container.press("ArrowRight"); // next node
await container.press("ArrowLeft"); // prev node
```

### Clicking a Specific Node

```ts
// Click first node
await graph.shadow().locator("state-node").first().click();

// Verify selected
const selected = graph.shadow().locator("state-node[selected]");
await expect(selected).toHaveCount(1);
```

### Accessing Nanostores from Browser Console

Stores are not exposed globally by default. For debugging:

```ts
// Evaluate store state via the page
const state = await page.evaluate(() => {
  // Access via Lit element internals
  const el = document.querySelector("actor-graph");
  // Or directly if stores are on window
  return window.__stores ? window.__stores.$graph.get() : null;
});
```

If stores not on window, add debug script to dev page.

---

## What to Test (Scriptable)

### Core State Transitions

| Step | Action        | Expected State |
| ---- | ------------- | -------------- |
| 1    | click START   | `working`      |
| 2    | click FINISH  | `reviewing`    |
| 3    | click APPROVE | `completed`    |
| 4    | click RESET   | `idling`       |

### Effect with Virtual Clock

| Step | Action               | Expected State |
| ---- | -------------------- | -------------- |
| 1    | click START          | `working`      |
| 2    | click "work timeout" | `timeout`      |
| 3    | click FINISH         | `reviewing`    |

### Full Loop

```
START → FINISH → REJECT → RETRY → FINISH → APPROVE → RESET
```

Verify each step.

### Button Enable/Disable

- At `idling`: only START enabled
- At `working`: FINISH enabled, START disabled
- At `reviewing`: APPROVE, REJECT enabled
- At `completed`: RESET enabled
- At `failed`: RETRY, RESET enabled
- At `timeout`: FINISH enabled

Test each.

### Effect Button Visibility

- only visible when `working` active
- hidden at all other states

### Layout Presets

- Each preset changes `$layoutOptions`
- All 6 presets produce valid layout (no crash)
- Default = RIGHT direction

### ELK Options

- Each elk button cycles through values
- Button text updates after click
- No crash on any combination

### Node Count

Always 6 nodes: idling, working, timeout, reviewing, completed, failed

### Edge Count

| Active State | Expected Edges                                 |
| ------------ | ---------------------------------------------- |
| idling       | 1 (START → working)                            |
| working      | 2 (FINISH → reviewing, WORK_TIMEOUT → timeout) |
| reviewing    | 2 (APPROVE → completed, REJECT → failed)       |
| failed       | 2 (RETRY → working, RESET → idling)            |
| completed    | 1 (RESET → idling)                             |
| timeout      | 1 (FINISH → reviewing)                         |

### Active Node Highlight

- Active state-node should have `.active` class or green tint in shadow DOM
- Non-active nodes should be white/gray

### Pan/Zoom Edge Cases

- Zoom in/out via scroll, then pan — view should stay consistent
- Double-click zoom in at various cursor positions
- `F` fits graph in view
- `0` resets to zoom=1, pan={0,0}
- Resize window, then `F` — recomputes correctly

### Rapid Event Spam

- Click START 10x fast — no crash, single state transition
- Click all buttons rapidly — no console errors

### Context Display

- Select a node → `node-details-panel` shows context data
- Context displays as formatted JSON with circular reference protection
- Empty context shows "No context" or empty block

### Payload Transitions

- Edge labels show event names
- Edges with guards show yellow `<span class="guard-tag">` tag
- Edges with actions show blue `<span class="action-tag">` tag
- Node details panel shows transitions with guard/action tags

### Search and Filter

- Type in `search-bar` → nodes matching query are highlighted
- Fuzzy matching works (partial matches, character skipping)
- Result count updates: `3 matches`
- Clear button (×) resets search
- `filter-controls` buttons: all/active/final/inactive
- Active filter button has `.active` class
- Filter + search combine (intersection)

### History Panel

- Transitions appear in `history-panel` after state changes
- Click entry → highlights that entry (`.active` class)
- Replay controls: ◀ (prev), ▶ (next), index display `[` and `]` keys
- Export button → downloads JSON file
- Clear button → empties history
- Panel shows "No transitions recorded" when empty

### Theme Toggle

- Click `theme-toggle` → cycles: light → dark → high-contrast → system
- `data-theme` attribute on `<html>` updates
- `data-mode` attribute on `theme-toggle` reflects current mode
- Theme persists across page reload (localStorage)

### Animation Toggle

- Click `animation-toggle .anim-btn` → toggles animations on/off
- Speed buttons: 0.5x, 1x, 2x, 4x
- Active speed has `.active` class
- `prefers-reduced-motion: reduce` → animations disabled, buttons dimmed

### Timer Indicator

- When timer active → `timer-indicator` shows badge with label
- Progress bar fills as time passes
- Pause button → timer pauses, badge gets `.paused` class
- Resume button → timer resumes
- Cancel button → timer cancelled, badge gets `.cancelled` class, text gets strikethrough

### Node Details Panel

- Click node → panel slides in from right (`.panel.open`)
- Shows: status badges, context, transitions, timers
- Close button (×) → panel closes
- Multiple transitions listed with event name and target state

### Minimap

- `minimap-component` renders canvas overview
- Click on minimap → pans main view to that position
- Drag on minimap → continuous pan
- Viewport rectangle shows current visible area
- Responsive: smaller on mobile breakpoints

### Export/Share

- Export SVG → downloads `.svg` file
- Export PNG → downloads `.png` file
- Copy state → clipboard with graph JSON
- Share URL → encodes graph state in URL parameters

---

## Writing Playwright Tests

Use `@playwright/test`. Example structure:

```ts
// tests/e2e/dev-page.spec.ts
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("http://localhost:5174/dev/");
});

test("starts at idling", async ({ page }) => {
  await expect(page.locator("#current-state")).toHaveText("State: idling");
});

test("START transitions to working", async ({ page }) => {
  await page.click("#buttons >> text=START");
  await expect(page.locator("#current-state")).toHaveText("State: working");
});
```

Run:

```bash
npx playwright test tests/e2e/
```

Or with `vp`:

```bash
npx playwright test
```

---

## Known Issues for LLMs to Explore

1. **ELK options do nothing visible.** Presets and elk toggles barely affect layout. Suspect: wrong ELK config, or ELK.js ignores certain options. Investigate with elk debug output.

2. **`considerModelOrder` value.** Code passes `"true"` string. ELK expect enum `NODES_AND_EDGES`, not string `"true"`. Might be silently ignored. Fix: pass proper enum value.

3. **Edge handlers called with empty args.** `buildEdgesFromTransitions` calls `handler({}, {})`. Guarded handlers or handlers that inspect event data throw → edge silently dropped. Make graph show all transitions correctly.

4. **Effect button indirection.** Not extracted from actor options. `effectDefs` hardcoded in `dev/main.ts`. If actor changes, effect buttons mismatch. Find way to auto-derive from actor.

5. **~~Minimap hidden.~~** RESOLVED. `<minimap-component>` now implemented with canvas rendering, drag-to-pan, touch support, and cached styles.

6. **No loading state.** Large graphs freeze UI during ELK layout. Add loading indicator back.

7. **ELK dynamic import fragile.** Type cast `as unknown as new () => ELK`. May break with upgrades.

8. **Pan sometimes breaks.** `firstUpdated` must find `.container` to register event listeners. Regression risk.

9. **~~No `data-theme="dark"` toggle on dev page.~~** RESOLVED. `<theme-toggle>` component cycles light→dark→high-contrast→system. Persists to localStorage.

10. **~~Stores not on window.~~** RESOLVED. Stores exported from `graph-store.ts`. `$graph` and `$layoutOptions` added for dev page use.

### Resolved This Session

- **Minimap implemented.** Canvas-based minimap with drag-to-pan navigation, touch support, cached computed styles, responsive breakpoints.
- **Theme toggle added.** `<theme-toggle>` cycles 4 modes, persists to localStorage, respects `prefers-color-scheme`.
- **Animation controls added.** `<animation-toggle>` with enable/disable and speed (0.5x/1x/2x/4x). Respects `prefers-reduced-motion`.
- **Search bar added.** `<search-bar>` with fuzzy matching, result count, clear button.
- **Filter controls added.** `<filter-controls>` with all/active/final/inactive status filtering.
- **History panel added.** `<history-panel>` with transition recording, replay (prev/step/next), export JSON, clear.
- **Node details panel added.** `<node-details-panel>` shows status badges, context data, transitions with guards/actions, timers.
- **Timer indicator added.** `<timer-indicator>` with progress bar, pause/resume/cancel controls.
- **Error handling improved.** Retry logic for layout computation, null-safe graph building, error scenario tests.
- **Performance optimizations.** Cached ELK layouts, debounced pan, HTML diffing, GPU acceleration hints, cached visible nodes.

---

## Performance Testing

### What to Measure

| Metric                | Target              | How                                               |
| --------------------- | ------------------- | ------------------------------------------------- |
| Layout computation    | <100ms for 20 nodes | `performance.now()` around `computeLayout()`      |
| Store → render cycle  | <16ms (60fps)       | Time from `$layout.set()` to Lit `updateComplete` |
| Initial render        | <200ms              | Time from `setActor()` to first paint             |
| Memory (large graphs) | <50MB for 100 nodes | Chrome DevTools Memory tab                        |
| Bundle size           | <50KB gzipped       | `vp build` then check `dist/`                     |

### Performance Test Pattern

```ts
import { performance } from "perf_hooks";

it("layout computation under 100ms for 20 nodes", async () => {
  const graph = createLargeGraph(20);
  const start = performance.now();
  await computeLayout(graph);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(100);
});
```

### Key Performance Optimizations

1. **Cached ELK layouts.** Same graph structure + options → cached result. `invalidateLayoutCache()` to clear.
2. **Debounced pan updates.** Pan events batched to animation frame. Store sync only on mouse release.
3. **HTML diffing.** `state-node` and `edge` skip innerHTML update if content unchanged.
4. **GPU hints.** `will-change: transform` on viewport, `contain: layout` on nodes.
5. **Cached visible nodes.** `getVisibleNodes()` caches filter+search results. Cache key includes filter, query, hit count, node count.
6. **Minimap style caching.** `getComputedStyle()` called once, cached for subsequent renders.
7. **History panel limits.** Renders last 50 entries max. Shows "... N earlier entries" for overflow.

### Profiling with DevTools

```bash
# Open dev server
vp dev

# Chrome DevTools:
# 1. Performance tab → Record → interact with graph → Stop
# 2. Look for long tasks (>50ms) in main thread
# 3. Memory tab → Take heap snapshot → interact → Take another → Compare
```

### Benchmark Script

```ts
// tests/benchmark.test.ts
import { describe, it } from "vite-plus/test";
import { computeLayout } from "../src/layout.ts";
import { buildGraph } from "../src/graph.ts";
import { performance } from "perf_hooks";

describe("benchmark", () => {
  it("layout 20 nodes", async () => {
    const graph = createLargeGraph(20);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await computeLayout(graph);
      times.push(performance.now() - start);
    }
    const avg = times.reduce((a, b) => a + b) / times.length;
    console.log(`Average layout time: ${avg.toFixed(2)}ms`);
  });
});
```

```bash
vp dev              # dev server port 5174
vp test             # unit tests (Vitest, watch mode)
vp test --run       # unit tests once
vp check            # format + lint + typecheck
vp check --fix      # auto-fix formatting
npx playwright test # e2e tests (after install)
vp build            # build package
vp install          # install deps
```
