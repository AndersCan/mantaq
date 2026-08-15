# @mantaq/sugar

Convenience helpers for [@mantaq/core](../core) actors — state/event
batching, pattern matching, effect utilities, composition, and dynamic
children.

## Install

```bash
npm install @mantaq/sugar
# or
pnpm add @mantaq/sugar
# or
yarn add @mantaq/sugar
```

## Quick Start

```ts
import { states, events, matches, withTimeout } from "@mantaq/sugar";
import { Actor, VirtualClock } from "@mantaq/core";

const s = states("idle", "loading", "success", "error");
const e = events("fetch", "resolve", "fail");

const clock = new VirtualClock();

const machine = new Actor({
  inputs: [e.fetch],
  internal: [e.resolve, e.fail],
  context: {},
  states: [s.idle, s.loading, s.success, s.error],
  initial: s.idle,
  clock,
  setup: (m) => {
    m.on(s.idle, e.fetch, () => ({ state: s.loading }));
    m.effect(s.loading, (input) => withTimeout(2000, input, () => e.resolve.create()));
    m.on(s.loading, e.resolve, () => ({ state: s.success }));
    m.on(s.loading, e.fail, () => ({ state: s.error }));
  },
});

matches(machine, "idle"); // true
machine.send(e.fetch.create());
matches(machine, "loading"); // true
clock.advance(2000);
matches(machine, "success"); // true
```

## Docs

Full guides live on the [Mantaq docs site](https://anderscan.github.io/mantaq/).

| Feature                                             | Docs                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `states()` / `events()` batch creation              | [Batch Creation](https://anderscan.github.io/mantaq/sugar/batch-creation/)       |
| `matches()` / `isIn()` / `activeLeaves()` / `tag()` | [Matching](https://anderscan.github.io/mantaq/sugar/matching/)                   |
| `definePart()` / `withParts()` setup composition    | [Composition](https://anderscan.github.io/mantaq/sugar/composition/)             |
| `withPromise()` / `withTimeout()` effect helpers    | [Effect Helpers](https://anderscan.github.io/mantaq/sugar/effect-helpers/)       |
| `ActorMap` / `broadcast()` dynamic children         | [Dynamic Children](https://anderscan.github.io/mantaq/sugar/dynamic-children/)   |
| Request / response handlers                         | [Request / Response](https://anderscan.github.io/mantaq/sugar/request-response/) |

Every export is documented with signatures in the
[API reference](https://anderscan.github.io/mantaq/reference/sugar/).

## License

MIT
