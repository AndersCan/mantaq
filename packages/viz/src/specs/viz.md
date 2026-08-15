# Viz composite spec

Batteries-included inspector: header + graph + inspector (context/events) +
timeline strip.

## Props

| Prop      | Type                    | Default   | Notes                    |
| --------- | ----------------------- | --------- | ------------------------ |
| `actor`   | `AnyActor`              | required  |                          |
| `options` | `VizOptions`            | `{}`      | see below                |
| `onError` | `(e: VizError) => void` | undefined | fires once per new error |

## VizOptions

```ts
{
  header?: boolean;            // default true
  defaultInspector?: boolean;  // default true (context panel open)
  defaultTimeline?: boolean;   // default true (timeline strip open)
  theme?: "light" | "dark";    // default: inherit [data-theme], else prefers-color-scheme
}
```

## Layout

Header 44px → error banner 32px (only on error) → main row (graph canvas
flex + inspector 320px fixed) → timeline strip 150px open / 32px collapsed.

Container query `< 900px` → inspector stacks below graph (`data-layout="narrow"`).

## Keyboard

`Space` play, `←`/`→` step, `f` fit, `0` live, `Esc` close popover.
**Key guard:** root keydown handler ignores the event when
`event.target` is a button/input/textarea/`[contenteditable]` or
`event.defaultPrevented` (Space must not double-trigger a focused button).

## Finite states

`ok` / `empty` / `error` / `done`.

## Don'ts

- No drag-resize.
- No dead controls: every rendered button wired or cut.
