---
"@mantaq/utils": patch
---

`Either.right()` with no argument builds a void right, so ports can return `Either<E, void>`.
