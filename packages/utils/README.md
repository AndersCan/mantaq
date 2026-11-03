# @mantaq/utils

Zero-dependency utility library for the mantaq actor system.

## Either

An `Either<L, R>` is a plain 2-tuple: left is `[value, undefined]`, right is
`[undefined, value]`. Exactly one slot is populated.

```ts
import { Either } from "@mantaq/utils";

const err = Either.left(new Error("boom"));
const ok = Either.right({ done: true });

Either.isRight(ok); // true
Either.getRight(ok); // { done: true }
Either.map(ok, (v) => v.done); // [undefined, true]
```

A right with nothing to carry is `Either.right()`, typed `Right<void>`:

```ts
const done: Either<Error, void> = Either.right(); // [undefined, undefined]
Either.isRight(done); // true
```

Errors flow as values. No exceptions.
