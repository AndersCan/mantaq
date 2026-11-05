# 0004. Remedies for constructs the diagram cannot represent

Status: accepted. Closes #286.

## Context

Per the #284 audit some constructs cannot be drawn faithfully from structure alone. `vision.md` says
core changes only when the diagram cannot be faithful without it. Core is budgeted at 1800 lines, 650
per file and 32 exports (`scripts/vision-guard.mjs:45-47`). There are no declarative guards: one way
of doing things.

## Decision

| Construct                     | Remedy                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler targets               | Builder `to` lands in `actor.options.targets` (done, #297). No core change.                                                                               |
| Effects                       | Core's `transition.effects` event already reports them (`packages/inspect/src/fuzz/run.ts:142`). No core change.                                          |
| Timer labels                  | Sugar `withTimeout` will pass `eventName` when scheduling (planned, T2; `VirtualClock` already accepts it); the factory is pure per the handler contract. |
| Handler throws                | A reported error, never an edge. `expectNoDesignErrors` fails on them.                                                                                    |
| `onAny` routing on live state | Stays a warning (`routingWarnings`).                                                                                                                      |
| Regions                       | Peer child actors, always active. Glossary corrected.                                                                                                     |
| Unknown targets               | `to: null`, drawn as undetermined (ADR 0001).                                                                                                             |

No core change is needed for any of these.

## Rejected options

- **Declarative guards.** Two ways to branch.
- **Core telemetry or registries for the visualizer.** The visualizer adapts to core, not the reverse.
- **Discovering targets by executing handlers on replayed state.** Superseded by declared targets.

## Consequences

- Design errors become CI failures through `expectNoDesignErrors`.
- The `eventName` label is informational; the fired event is unchanged.
