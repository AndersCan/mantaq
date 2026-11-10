# documented

Starts in `waiting`.

## States

### `waiting` (start)

Waiting for the visitor. Shows the welcome screen.

On entry runs `greet`.

On entry runs `chime`.

- `finish` → `done` (from any state)
- `start` → `done`: Starting moves on. Nothing is saved yet.

Ignores `again`, `last`, `more`.

### `done`

On entry runs `tidy`.

- `again` → `waiting`: First of the chain, see waiting.
- `finish` → `done` (from any state)
- `last` → `waiting`
- `more` → `waiting`: Second of the chain.

Ignores `start`.

### `idle`

On entry runs `tick`.

On entry runs `bell`.

- `finish` → `done` (from any state)

Ignores `again`, `last`, `more`, `start`.

## Events

- `again`
- `finish`
- `last`
- `more`
- `start`: The visitor pressed start.
