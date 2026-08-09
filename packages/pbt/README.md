# @mantaq/pbt

Seeded [fast-check](https://www.npmjs.com/package/fast-check) property-based
testing helpers and shared generators for the
[@mantaq/core](https://www.npmjs.com/package/@mantaq/core) actor system.

Runs are replayed identically: the seed is pinned (override with
`MANTAQ_SEED`) so a failing property can be reproduced byte-for-byte.
