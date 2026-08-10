# Mantaq

[![CI](https://github.com/AndersCan/mantaq/actions/workflows/ci.yml/badge.svg)](https://github.com/AndersCan/mantaq/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@mantaq/core?logo=npm&logoColor=white)](https://www.npmjs.com/package/@mantaq/core)
[![npm downloads](https://img.shields.io/npm/dm/@mantaq/core?logo=npm&logoColor=white)](https://www.npmjs.com/package/@mantaq/core)
[![npm provenance](https://img.shields.io/badge/SLSA%20provenance-verified-brightgreen?logo=github)](https://www.npmjs.com/package/@mantaq/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22.12-blue?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![skills.sh](https://skills.sh/b/AndersCan/mantaq)](https://skills.sh/AndersCan/mantaq)

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

## Skills

Agent skills for **end users** building with `@mantaq/core` — writing, testing, and reviewing actor-model code. These are **not** for developing the library itself.

```bash
npx skills add AndersCan/mantaq
```

The `mantaq` skill covers philosophy, building blocks, and transition rules, with sibling files for patterns, testing, sugar helpers, and review conventions.

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
