# Atlas: final report (phases 0–5)

Branch `feat/atlas`. Package `packages/atlas`. No `@mantaq/core` API changes.

## Built

| phase | what                                                                                                                                                                                       | where                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 0     | Recon: what traversal gives, 6 limitations                                                                                                                                                 | `docs/atlas/phase0-recon.md`                                      |
| 1     | Deterministic JSON export (probe structure + coverage from history)                                                                                                                        | `src/atlas.ts`, `src/serialize.ts`                                |
| 2     | Static viewer: dagre + hand-rolled SVG, `?` stubs for undetermined edges, coverage overlay (dash + opacity + legend), keyboard/click selection, side panel; `validateAtlas` / `parseAtlas` | `index.html`, `src/viewer/*`, `src/validate*.ts`                  |
| 3     | Coverage-guided fuzzer: seeded, fresh actor + VirtualClock per run, mutate / keep / shrink, writes coverage, fuzz-origin edges, corpus and handler errors into the document                | `src/fuzz/{fuzz,run,mutate,rng,to-atlas}.ts`                      |
| 4     | AST annotation (TypeScript compiler API): branches, reads/writes, live-state reads, comparisons, or `not_analyzed` with reason + snippet                                                   | `src/ast/*`                                                       |
| 5     | Literal seeding + branch-distance guide; 4-arm comparison over 30 seeds                                                                                                                    | `src/fuzz/{guided,compare}.ts`, `docs/atlas/phase5-comparison.md` |
| —     | One command: `vp run atlas:export` (probe → AST → guided fuzz → AST); `vp run atlas:compare`                                                                                               | `src/cli.ts`                                                      |

Schema went v1 → v2 (edge `origin`, kind `stay`, `machine.fuzz`) → v3 (`explanation`). It is unreleased, so there is no migration; the validator accepts only v3.

Tests: 77 in `packages/atlas`. They cover schema validation (round-trip plus one error test per section), deterministic output (snapshots, byte-identical export per seed), fuzzer replay (every kept sequence reproduces its features; kept sequences are 1-minimal), fuzzer ≥ hand-written coverage on every example, AST on conditional / ternary / stay / by-reference / switch / missing-source handlers, and viewer DOM assertions (no screenshots).

## Acceptance numbers

Fuzzer vs hand-written example tests (features = states + edges + stays reached, seed `0x1a51e`, 2000 iterations; tested in `fuzz.test.ts`):

| example  | hand-written | fuzz | missing from fuzz |
| -------- | -----------: | ---: | ----------------- |
| checkout |           12 |   17 | none              |
| auth     |           15 |   20 | none              |
| saga     |           22 |   29 | none              |

`atlas:export` for all four examples takes ~1.7 s (AST runs twice per file, 150–250 ms each); with `--no-ast` it takes ~0.3 s.

## Not built

- Phase 6 (skipped per handoff).
- Fuzzing of region (child) actors: the fuzzer observes the root actor only.
- Payload shape inference from observed handler reads (Proxy-based). I chose per-machine sample payloads instead: explicit, deterministic, and they keep payloads type-shaped. The cost is that someone has to write samples.
- Effect names on effect edges. Traversal labels effect self-loops by state, so the viewer says "effect". Fixing that means reading `options.effects` names in atlas (no core change needed); left out for scope.
- AST support for `switch`, loops and `try` around returns, and for handlers passed by reference. All are reported `not_analyzed`, never guessed.
- Screenshot goldens. One manual headless-Chrome pass checked layout; tests are DOM-only, per the spec.

## Decisions made (owner may want to revisit)

1. **Fixtures re-synced with the examples** (the Phase 0 open decision, option b, kept). The saga fixture had drifted: it invented `reservationId ? … : {}` conditionals and dropped context writes, which made `compensatingRelease` unreachable. All three fixtures now copy handlers verbatim, with effects stubbed. Drift risk remains; extracting factories from the example test files (option a) would remove it but touches the docs registry.
2. **Internal events are injected only when the current state handles them.** Core treats an unhandled internal event as an error. Fuzzing without this filter reported dozens of "errors" that no effect could ever cause.
3. **Payload mutation never drops keys or changes JSON types.** With key-drops, saga handlers "crashed" on `{}`-like payloads that TypeScript already forbids.
4. **The probed actor must be fresh.** The first Phase 2 export instrumented and drove the same actor it then probed, which made `back` look determined (all targets = the live state's answer). It is fixed and tested; `AtlasInput.actor` documents it.
5. **The AST never adds edges.** Branches the graph lacks are listed in the panel as "not in graph". The fuzzer is the only thing that adds edges, and only ones it observed.
6. **`atlas:export` fuzzes with guidance on**, because AST is on by default. `--no-ast` gives Phase 3 behaviour.
7. **New dependencies**: `@dagrejs/dagre` (layout), `typescript` (moved to runtime deps for the AST pass), `happy-dom` (dev, DOM tests), plus workspace `@mantaq/pbt` and `@mantaq/utils`.
8. **Lint override** for `packages/atlas/src/fixtures/**`: `max-lines-per-function` is off, because the verbatim saga mirror's `setup` is 139 lines (the examples are test files, where the rule is already off).

## Uncertain

- **Is branch distance worth keeping?** It gives no gain alone, and a 2× faster first hit only when combined with literals, on one synthetic fixture. Recommendation: keep the AST and literal seeding, and remove branch distance first if code budget matters (`phase5-comparison.md`).
- **`stay` edges from fuzzing vs probe-undetermined edges.** For auth's `MONITOR_TICK`, probing says "undetermined" (the handler returns `{}`), while fuzzing adds a `stay` per state. Both are shown. It might be cleaner for traversal to report `{}` as "stays" rather than undetermined, but that is a traversal change.
- **History-based coverage on probe edges** still conflates stay and self-loop (limitation 5) for probe-origin self-loops. Fuzz-origin edges do not.
- **Viewer at scale.** It was only tried on machines of up to 9 states and ~40 edges. Dagre layering is fine there; it is unknown beyond that.
