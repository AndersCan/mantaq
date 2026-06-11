# Mantaq

A TypeScript state machine library built around actors, events, and hierarchical states.

## Packages

- **core** — State machine runtime with actor model, event system, state hierarchy, effects, and virtual clock for testing.

## Getting Started

```bash
pnpm install
vp run ready
```

## Development

```bash
vp run dev        # start dev server
vp run -r test    # run all tests
vp run -r build   # build all packages
```

## Project Structure

```
mantaq/
├── packages/
│   ├── core/       # State machine runtime
│   ├── sugar/      # Convenience helpers
│   ├── viz/        # Visualizer (X6 + Lit web components)
│   ├── internals/  # Shared utilities
│   └── examples/   # Usage examples
├── apps/
│   └── docs/       # Documentation site
└── vite.config.ts  # Monorepo config
```
