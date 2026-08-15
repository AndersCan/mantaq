# EventPalette spec

Lets the user drive the actor: sends events into the live machine.

## Props

| Prop         | Type                                | Default     | Notes                             |
| ------------ | ----------------------------------- | ----------- | --------------------------------- |
| `actor`      | `AnyActor`                          | required    |                                   |
| `variant`    | `"full" \| "compact"`               | `"full"`    | compact hides Any/Internal groups |
| `onDispatch` | `(event: { type: string }) => void` | `undefined` | fired before `actor.send`         |

## Groups

- **Primary** — edges from the active state, non-internal (buttons).
- **Any** — from `options.transitions.Any` (buttons).
- **Internal** — display-only chips (spans, not buttons).

## Payload contract

Payload-typed events are disabled chips labeled `requires payload — not
sendable (v1)`. Only payload-free events are sendable. Rationale: `EventRef`
erases the payload generic at runtime, so no API can detect
payload-requiredness; firing empty payloads would corrupt context or trip
`__error`.

## Finite states

`ready` / `empty` (no sendable events → note) / `done` (all disabled + note).

## Don'ts

- No hotkeys.
- No payload editing.
- Internal chips are `<span>`, never fake buttons.
- No dead buttons: every button either sends or is a disabled chip with reason.
