# @mantaq/viz Vision

Extension of root `vision.md` for viz package

## viz Is

The visualizer. See what is happening. Make the actor's mental model visible.

viz exists so users can look at the actor and understand what they have made.

## Actor Is Source of Truth

viz reads the actor. viz renders the actor. viz may send events on the actor and may drive its lifecycle — but the actor is always the truth, and viz is always the view.

If viz shows X and the actor is in Y, viz is wrong. Always. No exceptions, no "intended" drift.

## Full Bidirectional, Bound by the Actor

viz interacts: fires transitions, advances timers, drives lifecycle. All of it routes through the actor's own public surface.

viz never mutates actor state directly. Never holds a parallel copy of state. Never decides "what the actor really means." Bidirectional means viz touches the actor through its API — not that viz becomes a second state owner.

## Pure Rendering Layer

Graph from snapshot. Layout from graph. Render from layout. No business logic lives here. If logic appears that should belong to core, sugar, or traversal, it does not belong in viz.

## Actor Paths via Traversal

viz uses the traversal package to understand actor paths. Any logic that walks an actor's state/region structure belongs in traversal — not in viz. viz consumes traversal's API; it does not re-implement path walking.

## viz Never Lies

Rendered state matches actor state. Rendered edges match declared transitions. Rendered effects match registered effects. Active highlight matches the live path. Any divergence is a viz bug, even if it "looks fine."

## Testable First

Two directions, both must hold:

- **viz matches actor** — given a snapshot, viz shows exactly that state path active.
- **actor behaves as viz suggests** — an edge viz shows as `A → B` on event `E` must produce `B` when `E` is sent in `A`.

A viz that shows a transition the actor cannot make is a bug, even if no user ever clicks it.
