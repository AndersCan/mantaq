# TransitionTimeline spec

Segmented scrubber over the deterministic transition history. Visual-only —
**never calls `recover`**, never rewinds the machine.

## Props

| Prop      | Type                                   | Default     | Notes                        |
| --------- | -------------------------------------- | ----------- | ---------------------------- |
| `actor`   | `AnyActor`                             | required    | recorder keys off this actor |
| `size`    | `100 \| 250 \| 500 \| 1000`            | `500`       | ring-buffer capacity         |
| `onScrub` | `(index: number \| undefined) => void` | `undefined` | `undefined` = live           |

## Finite states

`empty` (no entries → note) / `live` (last entry current) / `scrubbed`
(past/future dimmed, `[live ●]` button visible).

## Behavior

- Segments: past / current accent / future at 40% opacity.
- Play/pause/step `←`/`→`/back-to-live.
- Hidden range input for a11y + keyboard.
- **Scrub is visual-only:** `recover` is never called.

## Don'ts

- No `Date.now`/`Math.random` in render path.
- No dead controls: every button wired or cut.
- Keyboard guard: root keydown ignores events when target is a
  button/input/textarea/`[contenteditable]` or `defaultPrevented`.
