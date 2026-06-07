# @mantaq/core

State machine runtime with actor model, event system, state hierarchy, effects, and virtual clock for testing.

## Install

```bash
npm install @mantaq/core
```

## Quick start

```typescript
import { Actor, state, event } from "@mantaq/core";

const toggle = event("toggled")();
const on = state("on")();
const off = state("off")();

const light = new Actor({
  inputs: [toggle],
  states: [on, off],
  initial: off,
  transitions: {
    off: { toggled: () => ({ state: on }) },
    on: { toggled: () => ({ state: off }) },
  },
});

light.send(toggle);
console.log(light.state.name); // "on"
```

## Docs

See [mantaq.dev](https://mantaq.dev) for full documentation.
