# Visualizer Testing Guide (for LLMs)

## Quick Start

```bash
cd packages/visualizer
vp install        # install deps
vp dev            # dev server at http://localhost:5174
vp test           # run 98 unit tests (Vitest/jsdom)
vp check          # format + lint + typecheck
```

## Architecture (60s)

```
Actor (@mantaq/core)
  ↓ buildGraph()
ActorGraph (nodes[], edges[])
  ↓ computeLayout() via ELK.js
LayoutResult (nodes with x/y, edges with SVG path strings)
  ↓ nanostores ($graph, $layout, $zoom, $pan)
<actor-graph> Lit component
  ↓
<state-node> SVG rect + text per node
<edge-path> SVG path + arrow per edge
<minimap> Canvas overview (hidden, not rendered)
```

**Data flow:** Actor change → `setActor(actor)` → rebuild graph → compute layout → stores update → Lit re-renders

**Key files:**

- `src/graph.ts` — actor snapshot → graph data
- `src/layout.ts` — graph data → ELK.js positions
- `src/stores/graph-store.ts` — all state atoms
- `src/components/actor-graph.ts` — main container (pan/zoom/kbd)
- `src/components/state-node.ts` — single node SVG
- `src/components/edge.ts` — single edge SVG
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

5. **Minimap hidden.** `<minimap>` component registered but never rendered in `actor-graph.ts` template. Implement.

6. **No loading state.** Large graphs freeze UI during ELK layout. Add loading indicator back.

7. **ELK dynamic import fragile.** Type cast `as unknown as new () => ELK`. May break with upgrades.

8. **Pan sometimes breaks.** `firstUpdated` must find `.container` to register event listeners. Regression risk.

9. **No `data-theme="dark"` toggle on dev page.** `applyDarkTheme()` exists but no UI control. Add dark mode toggle.

10. **Stores not on window.** Debugging from Playwright `page.evaluate()` requires `window.__stores`. Add in dev.

---

## Commands Reference

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
