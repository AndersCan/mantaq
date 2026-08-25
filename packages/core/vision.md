# @mantaq/core Vision

Extension of root `vision.md` for core package

## core Is

The runtime. The primitives. mantaq, minus ergonomics.

core imports nothing above it. utils, the zero-dependency bottom layer (Either), is the one exception. core stands alone otherwise.

## Testable first

Core can not have bugs. Everything built on top of core. All code must have unit and mutation tests.

## Primitives, Nothing Else

States + Events. Context. Effects. Regions/Composition. Clock. That is the list.

New primitive must earn its place against every existing composition. If a recipe covers it, it stays a recipe. core is the last place scope creep lands.

## Errors Flow, Never Throw

Errors are events and states. Exceptions do not belong in runtime behavior.

Child failures bubble to the owner. No silent drops.

## Types Are Sacred

Type = behavior. Type-runtime mismatch is a design bug, not a test gap.

No casts to force the compiler quiet. No stringly-typed ids. Type flow carries from event to state to effect, end to end.

## Composition Over Primitives

Children compose through regions. Outputs route upward. No silent loss.

A pattern belongs in a recipe, not a primitive, until it proves it cannot compose its way out.

## Small Impl

Runtime code stays trivial. No surprises for the user. Surprise = bug.
