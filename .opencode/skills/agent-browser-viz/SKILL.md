---
name: agent-browser-viz
description: Test mantaq viz page with agent-browser. Use when user wants to verify actor behavior matches visual state, debug viz rendering, or test interactive flows on the viz playground. Covers both directions: verify viz matches actor state, and verify actor state matches expected behavior.
---

# Test Viz with agent-browser

Test actor models on viz page. Two directions:

1. **Actor → Viz**: Run actor, check viz shows correct state
2. **Viz → Actor**: Click viz buttons/edges, check actor state

Both matter. Use whichever fits the task.

## Setup

```bash
# Dev server must be running
cd packages/viz && vp dev dev

# Open page
agent-browser open http://localhost:5183/
```

## Actor mental model

Actor = state machine. Has states, transitions, events.

- `state("idle")()` — create state ref. Name = "idle"
- `state("paid")().final()` — final state. No transitions out. `isFinal: true`
- `event("PAY")()` — create event ref. Name = "PAY"
- `new Actor({ inputs, internal, outputs, states, initial, transitions, effects, regions })` — create actor
- `actor.send(event)` — dispatch event. Looks up transition for current state + event ID
- `actor.state.name` — current state name string
- `actor.state.isFinal` — true if final
- `actor.snapshot()` — `{ path, regions, done }`. `done` = true if final
- `actor.regions` — child actors (parallel). `actor.regions.payment.state.name`
- `actor.clock` — VirtualClock or RealClock. `actor.clock.advance(ms)` for VirtualClock

**Transition handler must be pure.** No side effects in handler. Side effects in `effects` on target state. Why: traversal calls handler to discover target state during graph building. Side effects fire on every render.

**Effects** run on state entry. `{ placed: [() => { ... }] }`. Effect input: `{ signal, state, event, context, emit, clock }`.

**Internal events** = actor handles itself. `internal: [PAY]`. Effect emits `PAY` → pushed to internal queue → actor processes.

**Output events** = forwarded to parent. `outputs: [PAYMENT_DONE]`. Transition emits `PAYMENT_DONE` → not in `#internalIds` → forwarded via `__outputHandler` → parent's internal queue → parent's `send()`.

## Approach 1: Actor → Viz

Verify viz matches actor state.

### Step 1: Know actor state

```bash
# Check current state
agent-browser eval "JSON.stringify({state: actor.state.name, isFinal: actor.state.isFinal})"

# Check regions
agent-browser eval "JSON.stringify({payment: actor.regions.payment.state.name, shipping: actor.regions.shipping.state.name})"

# Check snapshot (includes done flag)
agent-browser eval "JSON.stringify(actor.snapshot())"
```

### Step 2: Check viz shows it

```bash
# Get node colors. Active = fill #eff6ff. Inactive = fill #ffffff
agent-browser eval "
(() => {
  const gr = document.querySelector('#graph-root');
  const svg = gr?.querySelector('svg');
  if (!svg) return 'no svg';
  const nodes = svg.querySelectorAll('.x6-node');
  return JSON.stringify(Array.from(nodes).map(n => {
    const rect = n.querySelector('rect');
    const fill = rect?.getAttribute('fill') || 'none';
    const stroke = rect?.getAttribute('stroke') || 'none';
    return {id: n.getAttribute('data-cell-id') || n.id, fill, stroke};
  }));
})()
"
```

**Active node**: fill `#eff6ff`, stroke `#3b82f6` (blue) or `#059669` (green for final)
**Inactive node**: fill `#ffffff`, stroke `#64748b` (gray)
**Final node**: stroke `#059669` (green) regardless of active

### Step 3: Check edges

```bash
# Get edges
agent-browser eval "
(() => {
  const gr = document.querySelector('#graph-root');
  const svg = gr?.querySelector('svg');
  if (!svg) return 'no svg';
  const edges = svg.querySelectorAll('.x6-edge');
  return JSON.stringify(Array.from(edges).map(e => ({
    label: e.querySelector('text')?.textContent || '',
    id: e.getAttribute('data-cell-id') || e.id,
  })));
})()
"
```

### Step 4: Check toolbar buttons

```bash
# Buttons = available events for current state
agent-browser snapshot -i | grep "button"
```

Toolbar shows events for active states. If button missing but should exist → check `#getAvailableEvents` logic.

## Approach 2: Viz → Actor

Click viz, verify actor state changes correctly.

### Step 1: Get refs

```bash
agent-browser snapshot -i
# Note refs for buttons: @e10 = SUBMIT_ORDER, etc.
```

### Step 2: Click and check

```bash
# Click button
agent-browser click @e10

# Check actor state changed
agent-browser eval "JSON.stringify({state: actor.state.name})"
```

### Step 3: Advance clock (if VirtualClock)

```bash
# Effects with timers need manual clock advance
agent-browser eval "actor.clock.advance(3000)"

# Check state after timer
agent-browser eval "JSON.stringify({state: actor.state.name})"
```

### Step 4: Click edges

Edge clicks route to correct actor. Main edges → main actor. Region edges (e.g., `payment.pending-PAY-payment.paid`) → region actor.

```bash
# Click edge in graph
agent-browser eval "
(() => {
  const svg = document.querySelector('#graph-root svg');
  const edges = svg.querySelectorAll('.x6-edge');
  for (const e of edges) {
    if (e.querySelector('text')?.textContent === 'PAY') {
      e.dispatchEvent(new MouseEvent('click', {bubbles: true}));
      return 'clicked';
    }
  }
  return 'not found';
})()
"
```

Note: DOM dispatch may not trigger X6 events. Prefer toolbar buttons.

## Debug checklist

| Symptom                                             | Cause                                         | Fix                                                 |
| --------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| Region active after parent final                    | `collectActiveStates` walks regions when done | Check `snapshot.done` before walking                |
| Edge click sends to wrong actor                     | All edges go to main actor                    | `#resolveEdgeActor` parses edge ID prefix           |
| Console warn `no transition for event X in state Y` | Event sent to actor that can't handle it      | Check event routing, check `inputs`/`internal`      |
| Region not auto-transitioning                       | Output event not reaching parent              | Check `outputs` list, check `#processInternalQueue` |
| Active node wrong color                             | `collectActiveStates` prefix mismatch         | Check `nodeId(prefix, name)` consistency            |
| Effect timer not firing                             | VirtualClock not advanced                     | Call `actor.clock.advance(ms)`                      |
| Transition handler has side effects                 | Traversal calls handler during build          | Move side effects to `effects` on target state      |

## Full test pattern

```bash
# 1. Fresh start
agent-browser reload
sleep 1

# 2. Verify initial state
agent-browser eval "JSON.stringify({main: actor.state.name, payment: actor.regions.payment.state.name})"
# Expect: {main: "idle", payment: "idle", ...}

# 3. Click SUBMIT_ORDER
agent-browser snapshot -i | grep "button.*SUBMIT"
agent-browser click @e10

# 4. Verify placed state
agent-browser eval "JSON.stringify({main: actor.state.name, payment: actor.regions.payment.state.name})"
# Expect: {main: "placed", payment: "pending", ...}

# 5. Advance clock for effects
agent-browser eval "actor.clock.advance(3000)"
agent-browser eval "JSON.stringify({main: actor.state.name, payment: actor.regions.payment.state.name})"
# Expect: {main: "placed", payment: "paid", ...}

# 6. Check viz matches
agent-browser eval "
(() => {
  const gr = document.querySelector('#graph-root');
  const svg = gr?.querySelector('svg');
  const nodes = svg.querySelectorAll('.x6-node');
  return JSON.stringify(Array.from(nodes).map(n => {
    const rect = n.querySelector('rect');
    return {id: n.getAttribute('data-cell-id'), fill: rect?.getAttribute('fill')};
  }).filter(n => n.fill === '#eff6ff'));
})()
"
# Expect: active nodes match actor state

# 7. Check console clean
agent-browser console | grep -i "warn\|error\|drop"
# Expect: nothing (except Lit dev mode warning)
```

## Key files

- `packages/viz/dev/main.ts` — dev example with actors, regions, effects
- `packages/viz/dev/index.html` — page with `<mantaq-viz>` elements
- `packages/viz/src/components/mantaq-viz.ts` — viz component, toolbar, edge click routing
- `packages/viz/src/graph.ts` — graph builder, effect edge filtering
- `packages/traversal/src/graph.ts` — `buildGraph`, `collectActiveStates`
- `packages/core/src/actor.ts` — Actor class, send, transitions, effects
- `packages/core/src/state.ts` — `StateRef`, `.final()`, `IsFinal` generic
