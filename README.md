<div align="center">

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

</div>

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
vp install
vp run ready
```

## Usage

The docs tell one story — a multi-step checkout form. Same machine here.

```ts
import { Actor, state, event } from "@mantaq/core";

const basicInfo = state("basicInfo")();
const payment = state("payment")();
const success = state("success")().final();

const submitBasicInfo = event("SUBMIT_BASIC_INFO")();
const submitPayment = event("SUBMIT_PAYMENT")();

const checkout = new Actor({
  inputs: [submitBasicInfo, submitPayment],
  states: [basicInfo, payment, success],
  initial: basicInfo,
  setup: (m) => {
    m.on(basicInfo, submitBasicInfo, () => ({ state: payment }));
    m.on(payment, submitPayment, () => ({ state: success }));
  },
});

checkout.send(submitBasicInfo.create());
checkout.snapshot().path[0]; // "payment"
```

## Docs

The documentation site (`apps/docs`) builds **one running example** from start to
finish: the checkout form. Each page expands the machine from the previous
page. Entity IDs are fixed — the same states and events everywhere.

- Canonical example: `packages/examples/checkout.actor.test.ts`
- `vp run docs:check` — verifies docs use only canonical IDs, imports match real
  package exports, and the canonical example typechecks.
- `.opencode/skills/docs-write/` — agent skill for writing docs: single-example
  rules and a five-persona review loop (from `ux-research/personas-and-journeys.md`).

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

Versioning is manual; publishing runs in CI via npm trusted publishing (OIDC)
with SLSA provenance (`.github/workflows/release.yml`).

1. Accumulate bump files in `.bumpy/` as changes land.
2. When ready: `bumpy version` — bumps versions, writes changelogs,
   consumes bump files.
3. Commit the version changes, push, open a PR, merge to `main`.
4. The publish job builds every package and publishes the versioned ones.
   Publishing uses npm trusted publishing (OIDC) — no token secrets.

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
