# Actor UI Design

## Design Constraints (from PR #117 user research)

| Constraint                           | Source                      | Design Implication                                                      |
| ------------------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| Tiny ecosystem anxiety               | Team Lead, XState Refugee   | Visuals must communicate reliability, test coverage, type safety        |
| Need proven track record             | All personas                | Show real examples, not abstract diagrams. Link to working code         |
| Complexity must be simple            | UI Debugger, XState Refugee | Progressive disclosure. Simple default, deep on demand                  |
| "I can fix anything if I can see it" | UI Debugger                 | Active state must be immediately obvious. Transitions must be traceable |
| "Give me the internals"              | Library Builder             | Composable components. No black boxes                                   |

## Actor Complexity Dimensions

An actor in Mantaq can have:

1. **States** — named nodes (3 to 15+)
2. **Transitions** — edges labeled with events (sparse to dense)
3. **Regions** — concurrent child actors (nested state machines)
4. **Effects** — side effects bound to states (timers, async ops)
5. **Context** — mutable data carried across transitions
6. **Guards** — conditional transitions (currently implicit via handler logic)
7. **Internal events** — emitted and consumed within the actor
8. **Lifecycle** — initial state, final states, done signal

Current viz flattens all of this into one node-link diagram. That works for 6-state checkout flows but breaks down for saga orchestrators (9 states, 15+ edges, compensating paths) or network managers (regions with concurrent children).

---

## Design 1: Actor Identity Card

**Problem:** When you see a graph, you don't know _what_ you're looking at. Is it a checkout flow? An auth machine? A saga? No context.

**Solution:** A compact header card above the graph that summarizes the actor.

```
┌─────────────────────────────────────────────────────────┐
│  ● checkout                                            │
│  6 states · 4 events · 1 effect · 0 regions            │
│  ─────────────────────────────────                      │
│  Current: payment    Context: { basicInfo, shipping }   │
└─────────────────────────────────────────────────────────┘
```

### Anatomy

| Element         | Purpose                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `●` colored dot | Lifecycle: green=running, gray=idle, red=error, hollow=done              |
| Actor name      | Derived from variable name or explicit `.name`                           |
| Stats bar       | `N states · N events · N effects · N regions` — instant complexity gauge |
| Current state   | Bold, highlighted. Matches active node in graph                          |
| Context preview | First 2-3 non-empty field names. Click opens full context viewer         |

### Trust Signal

The stats bar is a subtle trust builder. "6 states, 4 events" tells the Team Lead this is manageable. "9 states, 14 events, 2 regions" tells them it handles real complexity. Both are honest.

---

## Design 2: Region Nesting (Container Nodes)

**Problem:** Network connection manager has two concurrent regions (`connectionState` + `healthMonitor`). Current viz flattens them into one graph. You lose the "these run in parallel" information.

**Solution:** Regions render as bordered containers. Child states live inside.

```
┌─ ConnectionManager ──────────────────────────────────────┐
│                                                          │
│  ┌─ connectionState ────────────────────────────────┐    │
│  │  ○ disconnected ──→ ○ connecting ──→ ● connected │    │
│  │                     │                             │    │
│  │                     ↓                             │    │
│  │                  ○ failed                         │    │
│  └───────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─ healthMonitor ──────────────────────────────────┐    │
│  │  ○ unknown ──→ ● healthy                         │    │
│  │                │                                  │    │
│  │                ↓                                  │    │
│  │             ○ degraded                            │    │
│  └───────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Visual Rules

| Element             | Style                                                      |
| ------------------- | ---------------------------------------------------------- |
| Region container    | Dashed border, light gray background, region name as label |
| Parent-only states  | Rendered outside region boxes (if any)                     |
| Cross-region events | Dotted arrow crossing container boundaries                 |
| Active region       | Subtle blue tint on container border                       |

### Interaction

- Click region header → collapse/expand (shows only region name + active state)
- Double-click region → focus mode (hide other regions, zoom to fit)

---

## Design 3: Effect Badges (Replace Self-Loop Edges)

**Problem:** Effects currently render as self-loop edges with amber dashed lines and labels like "EFFECT_1". For a state with 2 effects, you get 2 confusing loops. The saga orchestrator has effects on 5+ states — visual noise.

**Solution:** Replace self-loop edges with small badges on the state node.

```
  ┌──────────────────┐
  │   submitting  ⏱  │    ← badge icon indicates active effect
  │   ───────────     │
  │   800ms timer     │    ← badge tooltip shows detail
  └──────────────────┘
```

### Badge Types

| Icon | Meaning                                       |
| ---- | --------------------------------------------- |
| `⏱`  | Timer effect (`clock.setTimeout`)             |
| `↻`  | Interval effect (`clock.setInterval`)         |
| `⚡` | Async effect (promise-like, emits done/error) |
| `🔁` | Recurring effect (manual recursion pattern)   |

### Visual Rules

- Badge sits top-right corner of state node
- Active effect: badge pulses subtly (CSS animation)
- Multiple effects: stack badges vertically or show count `⏱×2`
- Click badge → expand effect detail panel (signal, abort, emit targets)

### Why This Works

Self-loops clutter the graph. Badges keep the graph clean while preserving the information. The UI Debugger sees "submitting has a timer" without tracing a loop. The Library Builder can click through to see the effect function signature.

---

## Design 4: Active Path Highlighting

**Problem:** In a 9-state saga, all nodes and edges render with equal visual weight. You can't instantly see "where am I and what happened."

**Solution:** Dim everything except the active path.

```
                    (dim)                (dim)
                 ○ ──────→ ○ ──────→ ○
                           │
                    (dim)  ↓  (ACTIVE)
                 ● ──────→ ● ──────→ ○
              idle      reserving   processing
                        Inventory   Payment
                                       │
                                (dim)  ↓
                                      ○
                                   completed
```

### Visual Rules

| Element         | Active Path                       | Inactive                            |
| --------------- | --------------------------------- | ----------------------------------- |
| State node      | Blue fill, bold border            | Gray fill, thin border, 40% opacity |
| Transition edge | Blue solid, animated dash         | Gray dashed, 30% opacity            |
| Event label     | Dark text, highlighted background | Light text, no background           |
| Initial dot     | Visible                           | 20% opacity                         |

### Transition Animation

When a transition fires:

1. Edge flashes green (existing `highlightTransition`)
2. Source node dims, target node brightens
3. 300ms ease transition

---

## Design 5: Event Palette (Contextual Actions)

**Problem:** Current toolbar shows ALL available events as flat buttons. For the saga, that's 10+ buttons. For auth, 6+ buttons. No indication of which events are _likely_ vs _edge cases_.

**Solution:** Group events by category, show probability/frequency hints.

```
┌─ Events ─────────────────────────────────────────────────┐
│                                                          │
│  ▶ Primary                                               │
│  [ SUBMIT_PAYMENT ]  [ BACK ]                            │
│                                                          │
│  ▷ Edge Cases                                            │
│  [ TIMEOUT ]  [ RETRY ]                                  │
│                                                          │
│  ▷ Internal (auto)                                       │
│  PAYMENT_PROCESSED · PAYMENT_FAILED                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Categories

| Category    | Source                                  | Style                                 |
| ----------- | --------------------------------------- | ------------------------------------- |
| Primary     | Transitions from active state (non-Any) | Solid buttons, prominent              |
| Edge Cases  | `Any` state transitions                 | Outlined buttons, muted               |
| Internal    | Events in `internal` array              | Text only, not clickable (auto-fired) |
| Unreachable | No transition from current state        | Disabled/hidden                       |

### Interaction

- Hover event button → highlight corresponding edge in graph
- Click event button → fire event, animate transition
- Keyboard shortcut: number keys 1-9 fire primary events in order

---

## Design 6: Transition Timeline

**Problem:** You see the current state but don't know _how you got here_. The UI Debugger needs to trace the path.

**Solution:** A horizontal timeline strip below the graph showing recent transitions.

```
┌─ Timeline ───────────────────────────────────────────────┐
│                                                          │
│  ○ idle ──START──→ ○ reserving ──RESERVED──→ ● payment   │
│       0ms            12ms              843ms              │
│                                                          │
│  [← undo] [redo →]                          [clear]     │
└──────────────────────────────────────────────────────────┘
```

### Features

| Feature          | Behavior                                          |
| ---------------- | ------------------------------------------------- |
| Click transition | Highlight edge in graph, scroll into view         |
| Click state node | Jump to that point in history (time-travel debug) |
| Undo/Redo        | Step backward/forward through history             |
| Timestamps       | Relative ms from actor creation                   |
| Max items        | Keep last 50 transitions, then scroll             |

### Trust Signal

Timeline proves the actor behaves predictably. "I sent START, it went to reserving. I sent RESERVED, it went to payment." This is the "proven track record" made visible.

---

## Design 7: Context Diff View

**Problem:** Current context viewer shows all fields. When a transition fires, you don't see _what changed_.

**Solution:** Show context as a diff when a transition fires.

```
┌─ Context Change ─────────────────────────────────────────┐
│  SUBMIT_BASIC_INFO: basicInfo → shippingAddress          │
│                                                          │
│  + basicInfo: { email: "a@b.com", name: "Anders" }      │
│    shippingAddress: undefined                            │
│    paymentInfo: undefined                                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Visual Rules

- `+` green = field added/changed
- `-` red = field removed
- `~` amber = field modified (show old → new)
- Unchanged fields collapsed under `{N fields unchanged}`

---

## Design 8: Trust Footer

**Problem:** "Tiny ecosystem" anxiety. Users need to know this isn't vaporware.

**Solution:** A subtle footer bar with trust indicators.

```
┌─────────────────────────────────────────────────────────┐
│  ✓ 34 tests passing    ✓ 100% type-safe    v0.3.0     │
│  Source: checkout.actor.test.ts:58                      │
└─────────────────────────────────────────────────────────┘
```

### Indicators

| Signal            | Source                 | Purpose                       |
| ----------------- | ---------------------- | ----------------------------- |
| Test count        | `actor.test.ts` file   | "This is tested"              |
| Type safety badge | TypeScript compilation | "Types won't betray you"      |
| Version           | Package.json           | "Real releases, not git main" |
| Source link       | File path + line       | "Click to see real code"      |
| Bundle size       | `dist/` analysis       | "Won't bloat your app"        |

---

## Composite Layout: Full Actor View

```
┌─ Actor Identity Card ────────────────────────────────────┐
│  ● checkout    6 states · 4 events · 1 effect            │
│  Current: payment    Context: { basicInfo, shipping }    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│              ┌──────────┐                                │
│         ──→  │ basicInfo │──→ ┌──────────────┐           │
│              └──────────┘     │ shippingAddr │           │
│                               └──────┬───────┘           │
│                                      │                   │
│                               ┌──────↓───────┐           │
│                    ┌─────────│   payment  ⏱  │─────────┐ │
│                    │         └───────────────┘         │ │
│                    │                                    │ │
│              ┌─────↓─────┐                    ┌────────┐│
│              │ submitting │──→ ┌─────────┐    │ error  ││
│              └────────────┘     │ success │    └────────┘│
│                                 └─────────┘              │
│                                                          │
├─ Event Palette ──────────────────────────────────────────┤
│  ▶ Primary:  [ BACK ]                                    │
│  ▷ Internal: SUBMITTING_DONE (auto, 800ms)              │
├─ Timeline ───────────────────────────────────────────────┤
│  ○ basicInfo ──SUBMIT──→ ○ shipping ──SUBMIT──→ ● pay   │
├─ Context ────────────────────────────────────────────────┤
│  basicInfo:  { email: "a@b.com", name: "Anders" }       │
│  shipping:   { street: "123 Main", city: "Berlin" }     │
├─ Trust Footer ───────────────────────────────────────────┤
│  ✓ 18 tests   ✓ type-safe   v0.3.0   source:58         │
└──────────────────────────────────────────────────────────┘
```

---

## Implementation Priority

| Phase  | Designs                                               | Effort | Impact                                                          |
| ------ | ----------------------------------------------------- | ------ | --------------------------------------------------------------- |
| **P0** | 1 (Identity Card), 4 (Active Path), 5 (Event Palette) | 3 days | Immediate clarity gain. Addresses "what am I looking at"        |
| **P1** | 3 (Effect Badges), 6 (Timeline)                       | 4 days | Debugging power. Addresses "I can fix anything if I can see it" |
| **P2** | 2 (Region Nesting), 7 (Context Diff)                  | 5 days | Complex actor support. Addresses regions, context changes       |
| **P3** | 8 (Trust Footer)                                      | 1 day  | Trust signal. Addresses ecosystem anxiety                       |

---

## Key Design Principles

1. **One glance = one answer.** Current state, available events, actor identity — all visible without clicking.
2. **Complexity on demand.** Simple actors look simple. Complex actors reveal depth through badges, nesting, and timelines — but only when you look.
3. **Honest signals.** Test counts, type safety, source links — not marketing. Show the proof.
4. **Dim the irrelevant.** Active path highlighting reduces cognitive load. You see what matters _now_.
5. **Replace loops with badges.** Self-loop edges are graph noise. Badges on nodes carry the same info cleaner.
6. **Time is a first-class dimension.** Timeline + context diff turn static diagrams into debuggable traces.
