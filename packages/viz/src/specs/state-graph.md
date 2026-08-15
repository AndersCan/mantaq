# StateGraph spec

The graph canvas. Renders the actor's states as nodes and its live transitions
as edges, with the active path highlighted.

## Props (max 8)

| Prop          | Type                                | Default     | Notes                                |
| ------------- | ----------------------------------- | ----------- | ------------------------------------ |
| `actor`       | `AnyActor`                          | required    | live actor; model derives from it    |
| `interactive` | `boolean`                           | `true`      | `false` disables pan/zoom/select     |
| `selectedId`  | `string \| undefined`               | `undefined` | controlled node selection            |
| `onSelect`    | `(id: string \| undefined) => void` | `undefined` | selection change callback            |
| `scrubIndex`  | `number \| undefined`               | `undefined` | when set, non-active edges/nodes dim |

No other props. No `string`-typed union props — node kinds are `"state" | "initial"`.

## Finite states

`ready` / `empty` (0 nodes → EmptyState card) / `error` (buildVizGraph failed →
last-good graph at 30% + error card, or card alone) / `dimmed-while-scrubbed`.

## Node states

`default` / `active` / `selected` / `initial` / `final` / `dimmed` / `hover` /
`focus-visible` / `error`.

## Edge states

`default` / `active` / `internal` (dashed) / `undetermined` (dashed red
self-loop, tooltip `no target resolved for EVENT`) / `selected` / `dimmed`.

## Don'ts

- No node dragging. `nodesDraggable={false}` always.
- No inline `style` for color/spacing/font. State via CSS class + data attrs.
- `fitView` only on mount / explicit `refit()`, never per-update.
- Every node carries `data-node-id`, every edge `data-edge-state` (structural
  gate reads these).
- No `return null` for empty/error — EmptyState and error card are renders.
