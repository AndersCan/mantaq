# Survey: how mastra models and renders its workflow graph

Issue #285 (map #283). Source: `/Users/anders/git/mastra` @ f3e1b237. Paths below relative to `packages/`. All claims from source read directly.

## Answer (short)

Mastra graph = **flat DAG built from a serialised linear step list**, dagre top-to-bottom layout, React Flow render. Nested things (sub-workflows, foreach bodies) are **not** laid out in the parent graph: they render in a **separate, second React Flow instance** in a detail panel. Fine for workflows; weak fit for statecharts. Reuse: dagre+xyflow wiring, measured-size relayout, dashed group overlay, camera focus. Do not reuse: graph construction, containment model.

## Model

- Input is `SerializedStepFlowEntry[]` (`core/src/workflows/types.ts:932`): a **sequence** of entries, each `step | sleep | sleepUntil | parallel | conditional | loop | foreach | agent | tool | mapping | workflow`. `parallel`/`conditional` carry a flat `steps[]`; `loop`/`foreach` carry one inner `step`; `workflow` carries nested `serializedStepFlow`.
- Conditions are opaque function source strings (`serializedConditions: {id, fn}`), shown as text. Optional `predicates` are declarative; closure-based ones "cannot be stored". Matches mantaq "opaque handlers" stance: mastra just prints `fn` source.
- Model is **structured (nesting by tree), edges implied by sequence position**. Graph is derived, not authored.

## Construction (`playground-ui/src/domains/workflows/workflow/utils.ts`)

- `constructNodesAndEdges` (l.517): iterate entries; `getStepNodeAndEdge` (l.85) emits nodes and edges from the previous entry's "exit node ids" (`prevNodeIds`) to the current entry's nodes. Parallel = fan-out from all prev nodes to each branch, fan-in on next entry. Conditional = extra synthetic `condition-node-<id>` per branch between prev and step.
- Per-type if-chains (~830 lines); throws on unknown type ("Studio does not support").
- Node ids uniqued by suffixing `-<yIndex>` when a step id repeats (graph nodes are occurrences; `stepId` kept in data).
- Synthetic `boundary-start` / `boundary-end` nodes; edges added from every source-less node and to every sink node.
- Edges carry data (`WorkflowDataEdgeData`, `playground-ui/src/ds/components/Workflow/graph/types.ts`): previous/next step id, `edgeStatus: success|idle`, payload label.

## Layout (`workflow-graph-layout.ts`, 46 lines)

- `@dagrejs/dagre`, `rankdir: 'TB'`, `ranksep 84`, `nodesep 64`. **Flat graph only**: no compound nodes (`setParent` unused). One `Dagre.layout` call over nodes+edges.
- Node size = measured DOM size, else fallback (274x100; 260 "large"; 112x38 boundary).
- Relayout on resize: `use-workflow-graph-nodes.ts` listens for React Flow `dimensions` changes, re-runs dagre, then offsets all nodes so the most-resized node stays anchored (no view jump).
- `nodesDraggable=false`: layout fully automatic and stable.

## Rendering (`ds/components/Workflow/graph/workflow-graph-canvas.tsx`)

- Thin wrapper over `@xyflow/react` `<ReactFlow>` (^12.10): custom `nodeTypes`/`edgeTypes`, read-only (no drag/connect/select/delete), dot `Background`, custom `ZoomSlider`, `fitView`, camera to a `focusNodeId` via `setCenter`, falling back to `fitView` when node exceeds viewport.
- Whole `ReactFlowProvider` remounted (`key=layoutKey`, JSON of graph) on graph change. Simple, not incremental.
- Runtime overlay: `use-workflow-graph-runtime.tsx` styles nodes/edges from run `steps[id].status`; edge `success` when prev step succeeded. Derived from run snapshot, not a live engine.

## Nesting / parallelism: what mastra does

- **Nested workflow / foreach body**: node has `stepGraph`; `workflow-body-graph.tsx` renders it as an **independent** `ReactFlowProvider` + canvas (variants `nested`/`inline`) in a panel, own Start/End boundary (relabelled "Each item"/"Item result"). Iteration picker for foreach. No visual containment in parent canvas.
- **Parallel**: sibling nodes at same dagre rank; no region box. `workflow-graph-groups.tsx` adds a dashed overlay (`WorkflowGraphGroup {id,label,description,nodeIds}`) = **bounding box of member node measurements**, in a div transformed by `useViewport()`. Pure visual annotation: dagre unaware, so it reserves no space and edges/other nodes may cross it.

## Carries over to statecharts

- dagre + xyflow stack, read-only canvas config, measured-size relayout with anchoring, camera focus on a node (maps to "current state" / navigation).
- Derived-graph-from-serialised-definition; opaque fn shown as source text; runtime status as overlay keyed by id.
- Synthetic start/end nodes (initial / final pseudo-states).
- Bounding-box group overlay: cheap region drawing _if_ layout already separates members.
- Separate nested canvas per child as drill-down fallback (fits a zoom-into-state navigation model).

## Does not carry over

- **No compound layout.** Statecharts need real containment (state boxes holding children, parallel regions side by side, edges crossing boundaries). Flat dagre cannot size a parent from laid-out children; group overlay is post-hoc. Needs dagre compound (`setParent`; known limits with edges to clusters), ELK layered with hierarchy, or custom recursive layout (lay out child, measure, feed size to parent). xyflow supports `parentId`/`extent` sub-flows, but layout is ours. (Last sentence about library capabilities is from general knowledge, not verified in the mastra repo.)
- **Sequence-implied edges.** Workflows get edges from order. Statecharts have explicit event-labelled transitions, self-loops, back-edges, multi-edges, cross-level edges. Dagre reverses edges to break cycles; mastra avoids cycles by making `loop` a node.
- **Hierarchy only via second canvas**; no notion of active ancestors.
- **Per-type if-chain construction with throw on unknown** conflicts with mantaq "errors are values"; build from one typed machine definition.
- **Status from persisted run snapshot**, not live Actor + VirtualClock + replay.
- **Full remount per graph change**; replay stepping needs restyle without relayout.

## Implications for the spec (#283)

1. @xyflow/react is a viable renderer (read-only config proven). Layout engine is the open choice: dagre alone is insufficient for nested/parallel regions.
2. Decide containment early: inline nested boxes (needs compound layout) vs drill-down canvases (mastra approach, cheap).
3. Separate layout input (static topology + measured sizes) from runtime overlay (active states, last transition) so replay only restyles.
4. Surface non-static parts explicitly (mastra prints opaque `fn` source; mantaq equivalent: handler targets not statically known).
