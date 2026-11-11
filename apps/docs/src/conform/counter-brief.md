# counterModel

Starts in `empty`.

## States

### `empty` (start)

Nothing counted yet.

- `increment` → `counting`
- `reset` → `empty` (from any state)

Ignores `decrement`.

### `counting`

Between zero and the maximum.

- `decrement` → `counting` when `!(count === 0)`
- `decrement` → `empty` when `count === 0`
- `increment` → `counting` when `!(count >= MAX)`
- `increment` → `full` when `count >= MAX`
- `reset` → `empty` (from any state)

### `full`

The counter stopped at the maximum.

- `decrement` → `counting`
- `reset` → `empty` (from any state)

Ignores `increment`.

## Events

- `decrement`: Subtract one, unless the counter is empty.
- `increment`: Add one, unless the counter is full.
- `reset`: Back to zero from any state.
