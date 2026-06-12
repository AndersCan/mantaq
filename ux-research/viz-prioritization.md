# Viz Package UX Rough Edges — Prioritization

## Scoring Rubric

| Score | Impact                           | Frequency     |
| ----- | -------------------------------- | ------------- |
| 1     | Minor annoyance                  | Rare          |
| 2     | Inconvenience                    | Occasional    |
| 3     | Significant friction             | Regular       |
| 4     | Major blocker                    | Frequent      |
| 5     | Complete blocker / trust breaker | Every session |

**Effort:** S (<1 day), M (1–3 days), L (3–5 days), XL (>5 days)

---

## Persona Reference

| ID     | Persona               | Role                        | Key Need                             |
| ------ | --------------------- | --------------------------- | ------------------------------------ |
| **D1** | Dev exploring library | New adopter, evaluating viz | Import works, see graph, zero config |
| **D2** | Dev integrating viz   | App builder, embedding viz  | Stable API, predictable behavior     |
| **D3** | Dev debugging state   | Troubleshooting transitions | Transparent errors, full data        |
| **S1** | Tech writer           | Docs / onboarding           | Accurate docs, working examples      |

---

## Individual Item Analysis

### CRITICAL

#### 1. TESTING-LLM.md describes non-existent package

| Field              | Value      |
| ------------------ | ---------- |
| Impact             | 4          |
| Frequency          | 3          |
| Impact × Frequency | **12**     |
| Effort             | S          |
| Personas           | D1, D3, S1 |
| Priority           | **P0**     |

TESTING-LLM.md lists 21 test files, 663 tests, 18+ source files. Actual: 3 test files (~34 tests), 10 source files. Any LLM-assisted debugging or contribution based on this doc wastes time and generates wrong test scaffolds. D3 debugging with LLM help gets completely wrong file paths. S1 writing docs from this file produces fiction.

---

#### 2. Dev harness broken (missing main.ts)

| Field              | Value      |
| ------------------ | ---------- |
| Impact             | 5          |
| Frequency          | 4          |
| Impact × Frequency | **20**     |
| Effort             | S          |
| Personas           | D1, D2, D3 |
| Priority           | **P0**     |

`dev/index.html` references `./main.ts` which does not exist. `vp dev` fails immediately. D1 evaluating library hits wall on first try. D2 can't visually debug. D3 can't reproduce issues locally. Single biggest trust breaker — "does this even work?"

---

### HIGH

#### 3. index.ts exports nothing documented

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 5      |
| Frequency          | 5      |
| Impact × Frequency | **25** |
| Effort             | S      |
| Personas           | D1, D2 |
| Priority           | **P0** |

`src/index.ts` only imports side-effect modules (custom element registrations). README documents `buildGraph`, `computeNodePositions`, `renderActorFlow`, `GraphNode`, `GraphEdge`, `ActorGraph`, `LayoutOptions` as exports. User doing `import { buildGraph } from "@mantaq/viz"` gets undefined. Every user who reads the API docs hits this. Complete blocker for programmatic usage.

---

#### 4. Silent error swallowing in transition handlers

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 4      |
| Frequency          | 3      |
| Impact × Frequency | **12** |
| Effort             | M      |
| Personas           | D3     |
| Priority           | **P1** |

`graph.ts:99-106` — transition handler execution wrapped in `try/catch` that sets `targetName = undefined`. No re-throw, no logging. Result: red undetermined arrow with zero indication of _why_. D3 debugging state machine sees phantom transition with no clue if it's guard failure, context issue, or bad handler.

---

#### 5. buildGraph swallows all errors

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 4      |
| Frequency          | 2      |
| Impact × Frequency | **8**  |
| Effort             | M      |
| Personas           | D2, D3 |
| Priority           | **P1** |

`graph.ts:260-263` — outer try/catch returns `{ nodes: [], edges: [] }` with `console.error`. Blank canvas, no feedback. D2 integrating gets silent empty viz. D3 debugging can't find error in console output mixed with other logs. Should surface error state in UI or throw.

---

#### 6. ContextViewer silently drops arrays, functions, symbols

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 3      |
| Frequency          | 4      |
| Impact × Frequency | **12** |
| Effort             | S      |
| Personas           | D2, D3 |
| Priority           | **P1** |

`context-viewer.ts:32-42` — `#detectType` returns null for arrays, functions, symbols. These fields render nothing — no placeholder, no "unsupported" badge, no row at all. D2 with array in context sees missing data. D3 debugging can't tell if field is absent or just hidden. Silent data loss.

---

### MEDIUM

#### 7. Global mutable state for highlight

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 3      |
| Frequency          | 2      |
| Impact × Frequency | **6**  |
| Effort             | M      |
| Personas           | D2     |
| Priority           | **P2** |

`sync.ts:10-11` — module-level `highlightTimeout` and `disposedGraphs`. Two `<mantaq-viz>` components on same page share one timeout. Highlighting in component A cancels highlight in component B. D2 building dashboard with multiple state machines gets flickering/cancelled highlights.

---

#### 8. Race condition in highlightTransition with disposed graphs

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 3      |
| Frequency          | 2      |
| Impact × Frequency | **6**  |
| Effort             | S      |
| Personas           | D2     |
| Priority           | **P2** |

`sync.ts:37-42` — timeout fires after graph disposal, checks `disposedGraphs.has(graph)` but `cell` was captured before disposal. Edge reference may be stale. WeakSet check helps but doesn't cover all timing windows. D2 rapid-mount/unmount cycles (SPA routing) could hit.

---

#### 9. Pervasive `as any` type escapes

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 2      |
| Frequency          | 3      |
| Impact × Frequency | **6**  |
| Effort             | M      |
| Personas           | D2     |
| Priority           | **P2** |

`sync.ts:67`, `sync.ts:80`, `mantaq-viz.ts:81`, `mantaq-viz.ts:368` — multiple `as any` casts bypass type safety. D2 relying on TypeScript for correctness gets no compile-time help when X6 API changes. Maintenance burden grows silently.

---

#### 10. Heavy type assertion abuse on actor.options

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 2      |
| Frequency          | 3      |
| Impact × Frequency | **6**  |
| Effort             | M      |
| Personas           | D2     |
| Priority           | **P2** |

`graph.ts:181`, `graph.ts:185`, `graph.ts:193`, `graph.ts:236` — four different casts on `actor.options` (`as Array<...>`, `as Record<...>`, `as Record<...>`, `as { initial?: ... }`). D2 extending or wrapping actor sees type mismatches. No shared type alias for the expected shape.

---

#### 11. Full re-render on every interaction

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 3      |
| Frequency          | 5      |
| Impact × Frequency | **15** |
| Effort             | L      |
| Personas           | D1, D2 |
| Priority           | **P1** |

`mantaq-viz.ts` — `#renderAll()` called on every button click, setting change, context edit, even settings gear toggle. Full lit-html re-render + `buildGraph` + `syncGraph` + `zoomToFit`. D1 with large state machine (20+ nodes) feels lag. D2 with frequent transitions sees UI jank. No throttle/debounce.

---

#### 12. Undetermined edge IDs create orphan nodes that flash

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 3      |
| Frequency          | 3      |
| Impact × Frequency | **9**  |
| Effort             | M      |
| Personas           | D1, D3 |
| Priority           | **P1** |

`graph.ts:112` — undetermined edges get `${sourceId}-undetermined-${eventId}` as target. These target nodes don't exist in state definition — X6 creates temp nodes that flash in/out on re-render. D1 sees visual glitches. D3 can't tell if node is real state or artifact.

---

#### 13. Edge config default router parameter duplicated

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 1      |
| Frequency          | 3      |
| Impact × Frequency | **3**  |
| Effort             | S      |
| Personas           | D2     |
| Priority           | **P3** |

`edge-style.ts:183`, `sync.ts:139`, `layout.ts:20` — `router: "normal"` default specified in three places. D2 overriding router in one place doesn't propagate. Minor but confusing during maintenance.

---

#### 14. No event meta or guard data surfaced in graph edges

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 3      |
| Frequency          | 3      |
| Impact × Frequency | **9**  |
| Effort             | L      |
| Personas           | D3     |
| Priority           | **P2** |

`GraphEdge` has `payload?: TransitionPayload` with guard/action/meta fields, but `edgeTooltip` only shows event name, source→target, internal flag. Guard expressions and action metadata never surface. D3 debugging guard logic gets no help from viz.

---

### LOW

#### 15. Dead UnoCSS theming code

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 1      |
| Frequency          | 1      |
| Impact × Frequency | **1**  |
| Effort             | S      |
| Personas           | D2     |
| Priority           | **P3** |

`uno.config.ts` defines 30+ CSS custom properties and shortcuts (`viz-panel`, `viz-btn`, etc.) never referenced by components. D2 looking to theme viz sees misleading config. Dead code adds confusion.

---

#### 16. README documents unimplemented keyboard shortcuts

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 2      |
| Frequency          | 2      |
| Impact × Frequency | **4**  |
| Effort             | S      |
| Personas           | D1, S1 |
| Priority           | **P3** |

README lists `+`, `-`, `0`, `F` shortcuts. None implemented in code. D1 tries shortcuts, nothing happens. S1 documents feature that doesn't exist.

---

#### 17. Naming confusion between onEdgeClick callback and onEdgeClick function

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 2      |
| Frequency          | 3      |
| Impact × Frequency | **6**  |
| Effort             | S      |
| Personas           | D2, D3 |
| Priority           | **P3** |

`actor-flow.ts:19` — option named `onEdgeClick` (callback). `actor-flow.ts:155` — internal function also named `onEdgeClick`. Same name, different things. D2 extending edge click behavior confused. D3 debugging gets ambiguous stack traces.

---

#### 18. effectLabel falls back to generic "Effect" string

| Field              | Value  |
| ------------------ | ------ |
| Impact             | 2      |
| Frequency          | 2      |
| Impact × Frequency | **4**  |
| Effort             | S      |
| Personas           | D2, D3 |
| Priority           | **P3** |

`edge-style.ts:71` — `effectLabel` returns `edge.effectLabel ?? "Effect"`. Timer effects without explicit label show generic text. D2 with multiple effects can't distinguish them. D3 debugging timer flow sees ambiguous labels.

---

## Priority Matrix — Sorted by Impact × Frequency

| Rank | #   | Issue                                               | Impact | Freq | I×F    | Effort | Priority | Personas   |
| ---- | --- | --------------------------------------------------- | ------ | ---- | ------ | ------ | -------- | ---------- |
| 1    | 3   | index.ts exports nothing documented                 | 5      | 5    | **25** | S      | **P0**   | D1, D2     |
| 2    | 2   | Dev harness broken (missing main.ts)                | 5      | 4    | **20** | S      | **P0**   | D1, D2, D3 |
| 3    | 11  | Full re-render on every interaction                 | 3      | 5    | **15** | L      | **P1**   | D1, D2     |
| 4    | 1   | TESTING-LLM.md describes non-existent package       | 4      | 3    | **12** | S      | **P0**   | D1, D3, S1 |
| 5    | 4   | Silent error swallowing in transitions              | 4      | 3    | **12** | M      | **P1**   | D3         |
| 6    | 6   | ContextViewer silently drops arrays/functions       | 3      | 4    | **12** | S      | **P1**   | D2, D3     |
| 7    | 12  | Undetermined edges create orphan flash-in/out nodes | 3      | 3    | **9**  | M      | **P1**   | D1, D3     |
| 8    | 5   | buildGraph swallows all errors                      | 4      | 2    | **8**  | M      | **P1**   | D2, D3     |
| 9    | 7   | Global mutable state for highlight                  | 3      | 2    | **6**  | M      | **P2**   | D2         |
| 10   | 8   | Race condition in highlightTransition               | 3      | 2    | **6**  | S      | **P2**   | D2         |
| 11   | 9   | Pervasive `as any` type escapes                     | 2      | 3    | **6**  | M      | **P2**   | D2         |
| 12   | 10  | Heavy type assertion abuse on actor.options         | 2      | 3    | **6**  | M      | **P2**   | D2         |
| 13   | 14  | No event meta/guard data surfaced in edges          | 3      | 3    | **9**  | L      | **P2**   | D3         |
| 14   | 17  | Naming confusion onEdgeClick (callback vs fn)       | 2      | 3    | **6**  | S      | **P3**   | D2, D3     |
| 15   | 16  | README documents unimplemented shortcuts            | 2      | 2    | **4**  | S      | **P3**   | D1, S1     |
| 16   | 18  | effectLabel falls back to generic "Effect"          | 2      | 2    | **4**  | S      | **P3**   | D2, D3     |
| 17   | 13  | Edge config default router duplicated 3×            | 1      | 3    | **3**  | S      | **P3**   | D2         |
| 18   | 15  | Dead UnoCSS theming code                            | 1      | 1    | **1**  | S      | **P3**   | D2         |

---

## Recommended Fix Order

### Phase 1 — Unblock (P0, ~2 days)

1. **#3** — Add proper re-exports to `index.ts` (S)
2. **#2** — Create `dev/main.ts` with working demo (S)
3. **#1** — Rewrite or delete TESTING-LLM.md to match reality (S)

### Phase 2 — Core Quality (P1, ~1 week)

4. **#11** — Add requestAnimationFrame throttle to `#renderAll()` (L)
5. **#4** — Surface transition errors in tooltip/edge data (M)
6. **#6** — Add "unsupported type" row/badge for arrays, functions (S)
7. **#12** — Create proper ghost nodes or hide undetermined targets (M)
8. **#5** — Surface buildGraph errors in component UI (M)

### Phase 3 — Polish (P2, ~1 week)

9. **#7** — Move highlight state to instance scope (M)
10. **#8** — Guard against disposed graph in timeout (S)
11. **#9-10** — Type cleanup, remove `as any` casts (M)
12. **#14** — Extend edge tooltip with guard/meta data (L)

### Phase 4 — Cleanup (P3, ~2 days)

13. **#13, #15, #16, #17, #18** — Dead code removal, naming fixes (S each)
