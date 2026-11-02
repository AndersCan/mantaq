# 0001. The viz document is the diagram model

Status: accepted. Closes #287.

## Context

The visualizer needs one model for nodes, edges, regions, undetermined edges, effects and context.
That model already exists in practice: `@mantaq/viz` is a versioned JSON document
(`VIZ_SCHEMA_VERSION = 8`, `packages/viz/src/schema.ts:5`). States carry a region, effects
(`sends`) and coverage. Edges carry `kind`, `origin`, `to: null` for an undetermined target, an AST
`explanation` and a `doc` (`schema.ts:53,60,149`). Navigation steps are `VizStep` = event | advance
(`schema.ts:172-174`). viz depends only on dagre and utils and runs nothing.

## Decision

The viz document is the single diagram model. It is extended by a schema version bump, never by a
parallel model. Regions stay peer machines whose ids are prefixed in the document. Producers (inspect)
fill the document; consumers (viewer, embeds) only read it.

## Rejected options

- **A new `@mantaq/diagram` package.** A second model beside viz v8. It breaks one-way and forces a
  converter between two shapes of the same thing.
- **Letting the viewer read the actor directly.** The viewer would need core and stop being a pure
  reader of JSON.

## Consequences

- Every new diagram feature starts as a schema change plus a version bump.
- Documents stay serialisable, diffable and shareable.
- Anything the model cannot express is marked undetermined or handled by a remedy (ADR 0004).
