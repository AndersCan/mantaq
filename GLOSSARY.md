# Mantaq Glossary. State Machines & Statecharts

Mantaq is a library for building **state machines**. If you've never met the
term, this page is for you: every concept you need, defined from scratch, with
the Mantaq spelling next to it.

## The machine, in one paragraph

A **state machine** models something that is always in exactly one of a few
known situations. A checkout form is either collecting an address, or charging
a card, or done. Never two at once, never an unplanned in-between. The
machine changes situation only when a specific thing happens, and the same
thing happening in the same situation always leads to the same result. Because
the situations and the changes are written down up front, you can see every
possible path before you run anything.

Mantaq builds the richer kind of machine, called a **statechart**: states can
be nested inside states, several parts can run at once, and the machine can
carry data alongside "where it is". Everything below describes that model.

## Vocabulary

| Term              | Meaning                                                                                              | In Mantaq                               |
| ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **State machine** | A model where the thing is in exactly one of a known set of states, and events move it between them. | The general idea you model with Mantaq. |
| **Statechart**    | An extended state machine: states nest, run in parallel, and carry data. Mantaq's actual model.      | What an `Actor` is.                     |

| **State** | One situation the machine can be in, a named point in the flow. Answer: "where am I?" | `state("payment")()` builds a state. States are declared and listed in the actor. |
| **Event** | An occurrence the machine reacts to. The only thing that moves a machine. | `event("submitPayment")()` builds one. You send it with `actor.send(...)`. |
| **Transition** | A move from one state to another, triggered by an event. | A handler you register that says "on this event in this state, go there". |
| **Source state** | The state a transition leaves. | The current state when the event arrives. |
| **Target state** | The state a transition enters. | The `state` your handler returns. |
| **Trigger** | The event that starts a transition. | The `event` you pass to a handler. |
| **Guard** | A condition a transition must pass to fire. If it fails, the machine stays. | Handler logic that returns "stay put" instead of "go there". |
| **Action** | Code the machine runs as part of handling an event: read the event, update data, fire follow-up events. | The body of your handler. |
| **Entry action** | Code run every time a state is entered, first entry included. | `m.effect(state, { name, fn })`. Runs on entry into that state. |
| **Exit action** | Code run when a state is left. | Not explicit in Mantaq: leaving a state cancels the effect's in-flight work (abort signal). |
| **Self-transition** | A transition back to the state it came from. Exits and re-enters: entry actions run again. | Returning the current state as target. |
| **Internal transition** | Handling an event without leaving the state. No entry/exit actions, the machine just does the work. | A handler that does the work and returns "stay put". |
| **Initial state** | Where the machine starts. | The `initial` option of an `Actor`. |
| **Final state** | A state that means "done". Entering it ends the machine. | `state("success")().final()`. Entering it signals completion. |
| **Extended state** | Data the machine carries next to its current state. The "machine" and its "data" are two different things. | `context`. Survives transitions, read and written by handlers. |
| **Active state configuration** | The full picture of where the machine is, including nested and parallel states. | `actor.snapshot()`. The live state tree. |
| **Compound state** | A state that contains other states. A machine inside a machine. | A child `Actor` attached to a parent. |
| **Orthogonal regions** | Parallel parts of a compound state, all running at the same time. | Multiple children in `regions`. |
| **History state** | A mark that remembers the last active substate, so a return picks up where the machine left off. | Not supported. |
| **Choice** | A branch point decided by conditions at the moment the event arrives. | Branching in a handler (`if` on the current state or data). |
| **Completion** | The event a machine signals when it reaches a final state. | The `"done"` event. Subscribe with `on("done", ...)`. |
| **Timeout** | A transition triggered by elapsed time instead of a message. Time is another event source. | `withTimeout(ms, input, event)` in sugar wraps `clock.setTimeout` with abort handling. |
| **Determinism** | The same event hitting the same state leads to the same result, every time. Nothing hidden, no wall clock. | Built in: same inputs, same trace, always. |
