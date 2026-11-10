# retry

Starts in `idle`.

## States

### `idle` (start)

No connection yet.

- `connect` → `connecting`

Ignores `reset`.

### `connected` (final)

The connection is up.

Final: takes no events.

### `connecting`

Trying to connect.

- `failed` → `lockedOut` when `current.attempts > 10`
- `failed` → stays when `!(current.attempts > 10)`
- `opened` → `connected`

Ignores `connect`, `reset`.

### `lockedOut`

Too many failed tries; locked out.

- `reset` → `idle`

Ignores `connect`.

## Events

- `connect`: A connection attempt was requested.
- `failed` with `reason: string` (internal): The connection attempt failed.
- `opened` (internal): The connection opened.
- `reset`: The lockout was cleared.
