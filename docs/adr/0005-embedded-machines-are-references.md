# 0005. Embedded machines are references, not inlined parts

Status: accepted. Part of the nested-machines work (split a big machine into several machines).

## Context

A machine must not need to be huge to be viewed. A big machine gets split into several machines,
and a state of one machine can embed another. The viewer draws that state like any state, with its
edges, and you can enter it to see the embedded machine or skip it.

The document already has one way to show parts. ADR 0001 keeps regions as peer machines whose ids
are prefixed in the document. ADR 0004 says regions are peer child actors, always active. A machine
that the factory returns next to the actor (`actors`) is inlined the same way: its states sit in
the owner's `states` with a prefix (`stock.holding`). The layout runs once over all these states,
so its cost follows the size of the whole board.

## Decision

Schema 19 adds `VizState.machine`: the id of another machine in the same document. An embedded
machine is not inlined and gets no prefixed ids. The document stays a flat list of machines. The
viewer lays out each machine on its own, so the layout cost follows the largest single machine.

The validator refuses a reference to a machine that is not in the document. It also refuses a
cycle, a machine that embeds itself through a chain of embeds. It reports each reference on the
cycle, at that state's `machine` path, with the chain (`order > payment > order`).

The key is omitted for a plain state, like the other optional keys (`actor`, `removed`). Producers
do not fill it yet.

## Rejected options

- Inline the embedded machine with prefixed ids, as regions and returned actors are. One
  layout over every state of every embedded machine. Its cost grows with the whole tree, which is
  the problem the split is meant to solve. Also, one machine embedded in two states is copied twice.
- A nested `machines` list inside a state. The same copy problem, and readers of the document
  need a tree walk to find a machine by id.
- A required `machine: null` key. Every producer and every hand-built test state changes for a
  key that is empty almost everywhere.

## Consequences

- Regions and returned actors stay peers inside one machine (ADR 0001, 0004). Embedded machines
  are separate machines that a state points to.
- A reader that wants the inside of an embedded state looks the id up in `machines`.
- A producer that writes one document per file (the Astro integration) must also add each embedded
  machine, and the machines that it embeds, to that document.
- The live page cuts a document down to the shown machine (`live-page.ts`). To enter an embedded
  state, it must keep the machines that the shown one embeds.
- The validator does not yet refuse two machines with the same id. With references, such a
  document is ambiguous. That check is a follow-up.
