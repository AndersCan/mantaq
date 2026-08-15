# @mantaq/viz visual spec

Tokens prevent off-scale values; this spec defines the rhythm so an agent
inherits coherence, not just variables.

## Type-role hierarchy

- State node label: `--mtq-font-base` sans, weight 600.
- Edge label: `--mtq-font-size-xs` mono on a `--mtq-graph-edge-label-bg` chip.
- Badge: `--mtq-font-size-xs`.
- Panel headers: `--mtq-font-size-sm` weight 600 uppercase-ish tracking.
- Event buttons: `--mtq-font-size-xs` mono.
- `--mtq-font-mono` reserved for event names / state ids / context values —
  the "identifier" style signal.

## Spacing mapping

- `--mtq-sp-1` micro (chip padding).
- `--mtq-sp-2` compact gaps (button rows, badge stacks).
- `--mtq-sp-3` panel padding.
- `--mtq-sp-4` section rhythm (panel header → content).
- `--mtq-sp-6` empty-state block.
- Never sp-4 for a gap between buttons.

## Node anatomy

Rounded `--mtq-radius-md`, 1px `--mtq-border` stroke, `--mtq-bg-raised` fill,
label centered, effect badges top-right as small `--mtq-radius-full` chips,
active = accent fill + `--mtq-text-on-accent`. Final = single
`--mtq-graph-node-final` outer ring. Initial = hollow accent ring.
No shadows, no gradients, no extra decorations.

## Progressive disclosure

Visible by default: graph + active path, ActorBadge stats, Primary events,
top-level context keys, last 8 timeline segments. Behind interaction:
Any/Internal groups, context subtrees + diff, older timeline, effect details,
error detail. Complexity renders as counts, never as content.

## Empty & error states (the "never lie" contract)

1. 0 nodes → EmptyState card: `"No states to visualize"` + why-bullets. Not a
   blank canvas.
2. `buildVizGraph` fails → last-good graph (if any) at 30% under an error card
   with `copy error`; never-succeeded → card replaces canvas. `onError` fires
   once per new error.
3. Actor in `__error` → ErrorBanner + red-tinted active node + timeline error
   entry. Graph stays visible, palette stays enabled — debug the failed
   machine by driving it.
4. Guard-rejected / no-target transition → dashed-red undetermined self-loop +
   tooltip `no target resolved for EVENT`. Timeline entry `transitioned: false`.
5. Unhandled context values → badges/placeholders. Never dropped, never
   `[object Object]`.
