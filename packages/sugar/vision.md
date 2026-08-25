# @mantaq/sugar Vision

Extension of root `vision.md` for sugar package

## sugar Is

Sugar provides sugar syntax. Core verbose, sugar concise

sugar is ergonomics for mantaq and mantaq only - no sugar that could be standalone npm package.

## Testable First

sugar sits between user and core. Mistakes leak through. All code must have unit and mutation tests.

## Earned Surface

Every export must justify itself against the raw core it removes friction from. If raw core is just as easy, sugar should not ship it.

## Never Shadows core

sugar wraps; it does not replace. Never re-implement core behavior. Never re-export core under a different name with different semantics.

Needs a new primitive? It belongs in core, not sugar.

## Types Carry On

sugar inherits core's type flow and does not weaken it. No casts. No `any`. No stringly-typed keys. sugar that drops type safety to gain ergonomics has failed at both.

## No Behavior core Lacks

sugar does not add power. Impossible for a sugar export to "do something core can't"
