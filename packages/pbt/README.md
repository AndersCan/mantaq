# @mantaq/pbt

Seeded [fast-check](https://www.npmjs.com/package/fast-check) property-based
testing helpers and shared generators for the
[@mantaq/core](https://www.npmjs.com/package/@mantaq/core) actor system.

Runs are replayed identically: the seed is pinned (override with
`MANTAQ_SEED`) so a failing property can be reproduced byte-for-byte.

`MANTAQ_SEED` must be an integer. Unset or empty keeps the default
`DEFAULT_SEED`. A non-integer value is rejected: `parseSeed` returns a
`Left<SeedError>` (exposed as the module-level `seedError`) instead of
silently falling back, so a misconfigured seed can never masquerade as a
reproducible run.
