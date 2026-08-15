# ErrorBanner spec

Surfaces actor errors — never swallowed, never a blank canvas.

## Props

| Prop        | Type         | Default   | Notes                                    |
| ----------- | ------------ | --------- | ---------------------------------------- |
| `error`     | `VizError`   | required  | `{ kind: "graph" } \| { kind: "actor" }` |
| `onDismiss` | `() => void` | undefined |                                          |

## Finite states

`visible` / `dismissed`.

## Contract

- `role="alert"` + `aria-live="assertive"`.
- Reason chip, event, state; copy button for graph errors.
- No auto-dismiss.
