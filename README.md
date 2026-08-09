# Mantaq

A TypeScript state machine library built around actors, events, and hierarchical states.

## Packages

- **core** — State machine runtime with actor model, event system, state hierarchy, effects, and virtual clock for testing.
- **sugar** — Convenience helpers: batch state/event creation, matching, effect utilities, dynamic children.
- **traversal** — Graph build, coverage instrumentation, and history for testing state machines.
- **test** — Test harness and coverage assertions for actor behavior.
- **utils** — Shared internal utilities.
- **examples** — Real working examples (checkout, auth, saga, event sourcing, undo/redo, and more).

## Getting Started

```bash
npm install @mantaq/core
```

From the repo (development):

```bash
pnpm install
vp run ready
```

## Usage

```ts
import { Actor, state, event } from "@mantaq/core";

const idle = state("idle")();
const running = state("running")();
const start = event("START")();

const actor = new Actor({
  inputs: [start],
  states: [idle, running],
  initial: idle,
  setup: (m) => {
    m.on(idle, start, () => ({ state: running }));
  },
});

actor.send(start.create());
actor.snapshot().path[0]; // "running"
```

## Development

```bash
vp run dev        # start dev server
vp run -r test    # run all tests
vp run -r build   # build all packages
```

## Releasing

Versioning is manual; publishing runs in CI with npm provenance
(`.github/workflows/release.yml`).

1. Accumulate bump files in `.bumpy/` as changes land.
2. When ready: `bumpy version` — bumps versions, writes changelogs,
   consumes bump files.
3. Commit the version changes, push, open a PR, merge to `main`.
4. The publish job builds every package and publishes the versioned ones.
   Requires the `NPM_TOKEN` secret (an npm automation token).

## Project Structure

```
mantaq/
├── packages/
│   ├── core/        # State machine runtime
│   ├── sugar/       # Convenience helpers
│   ├── traversal/   # Graph + coverage testing tools
│   ├── test/        # Test harness
│   ├── pbt/         # Seeded property-based testing helpers
│   ├── utils/       # Shared utilities
│   └── examples/    # Usage examples
├── apps/
│   └── docs/        # Documentation site
└── vite.config.ts   # Monorepo config
```
