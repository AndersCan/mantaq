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

Errors flow as values — no exceptions.
