# 0002. Extraction: declared targets from the real actor, TypeScript checker for enrichment

Status: accepted. Closes #290.

## Context

Edges must come from the real machine, never a guess (`vision.md`, "The visualizer"). Since #297 the
builder's `to` lands in `actor.options.targets`, and inspect draws edges from it; nothing runs to find
them (`packages/inspect/README.md`, "Structure"). Source analysis already uses the TypeScript 6.0.3
checker on Node only (`packages/inspect/src/ast/program.ts:4`, catalog `typescript: "6.0.3"` in
`pnpm-workspace.yaml:21`). It supplies explanations, payload samples, docs and factory discovery
(`ast/discover.ts:15-17`, `call: "instance" | "call" | "clock" | "options"`). There is no oxc.

## Decision

1. Edges come from declared targets on the real actor.
2. The TypeScript 6.x checker enriches (docs, explanations, payload samples, discovery). It is not the
   edge source.
3. It runs on Node only: CLI, Vite plugin and build step. Never in the browser.
4. The checker sits behind `ast/program.ts`. When TypeScript 7 ships a JS API, swap it there.
5. Handler throws found by fuzzing are reported errors, not edges.

## Rejected options

- **oxc.** Syntax only: it cannot read handler types, which payload samples and explanations need.
  With declared targets it would add a second extraction path and no new edges.
- **In-browser analysis (wasm TypeScript).** Heavy, and the diagram is a dev-time artifact. It would
  put visualizer code in the deployed bundle, which `vision.md` forbids.
- **TypeScript 7 now.** No JS API yet.
- **Edges from static AST parsing of handler bodies.** A second source of truth that can disagree with
  the real actor.

## Consequences

- Machines are analysable by construction: declare targets with `to`.
- Replay is the cross-check: fuzzing and live runs exercise the same actor the edges came from.
- `@mantaq/traversal` (`origin: "probe"`) is unsound per #284 and still feeds inspect. Out of scope
  here; it needs its own issue.
