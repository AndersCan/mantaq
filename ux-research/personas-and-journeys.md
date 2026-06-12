# Mantaq User Personas & Journey Maps

---

## Persona 1: The XState Refugee

**Age:** 32 | Occupation: Senior Frontend Engineer | Location: Berlin, Germany

### Goals

- Migrate an existing complex multi-step checkout flow away from XState v5 before deadline
- Find a state management solution that doesn't require a PhD to explain to junior devs
- Ship maintainable features without fighting the tooling

### Pain Points

- XState v5 API surface is massive. Every time he looks up docs, he finds another deprecated pattern or a migration guide referencing something he never used
- Visualizer is slow, requires extra setup, and doesn't integrate cleanly with his Vite-based workflow
- Spent two weeks debugging a state machine that worked perfectly but produced silent transitions because he missed a guard condition
- Team spent 40 hours on XState migration training that still left people confused

### Behaviors

- Currently uses vanilla JavaScript state objects with manual transition functions
- Tried XState v5 for three weeks, abandoned it after onboarding two team members
- Evaluates libraries by reading source code, running benchmarks, and testing DX before adoption
- Comfortable with TypeScript, prefers type inference over manual type definitions

> "I don't need a state machine library that teaches me computer science. I need one that gets out of my way and lets me ship."

---

## Persona 2: The UI Debugger

**Age:** 27 | Occupation: Mid-level Frontend Developer | Location: Austin, Texas

### Goals

- Understand why a React component's state behaves unexpectedly during user testing
- Debug conditional rendering issues caused by state transitions in a feature flag system
- Visualize state flow without adding complex logging or console.log debugging

### Pain Points

- Debugging state-related UI issues means adding temporary console.log statements everywhere, then cleaning them up later
- Can't explain to her PM why a button appears in certain states but not others
- Component state libraries don't provide visualization. She has to mentally model the state machine
- Spent 3 hours last week tracing a race condition where two async handlers competed for the same state slot

### Behaviors

- Uses React DevTools and browser console as primary debugging tools
- Has heard of state machines but finds formal notation intimidating
- Wants visualization that works in the browser without extra tooling setup
- Prefers learning through exploration rather than documentation reading

> "I can fix anything if I can see it. Right now state is invisible and that scares me."

---

## Persona 3: The Library Builder

**Age:** 35 | Occupation: Senior Library Author / OSS Maintainer | Location: Amsterdam, Netherlands

### Goals

- Build a developer tool that uses internal state machines and expose their state to users
- Embed a lightweight state machine visualization component into his library's documentation site
- Ship a polished, type-safe DX that doesn't depend on bloated runtime dependencies

### Pain Points

- Needs direct access to state machine internals (transitions, guards, effects) which most high-level libraries abstract away
- Current viz solution pulls in XState as a dependency, adding 40KB+ to his library's bundle
- Wants to customize node/edge rendering but the current viz components are not composable
- Error handling is opaque—when a machine fails to transition, the viz shows a red arrow with no explanation

### Behaviors

- Reads source code of visualization libraries before adopting them
- Has built custom SVG renderers for state graphs in the past
- Contributes upstream fixes to OSS dependencies he uses
- Prefers libraries with explicit APIs over convention-heavy approaches

> "Give me the internals. I'll compose them myself. Don't hide the machine behind a pretty abstraction."

---

## Persona 4: The Team Lead

**Age:** 39 | Occupation: Engineering Manager | Location: Toronto, Canada

### Goals

- Evaluate Mantaq as the team's standard state management approach before Q3 planning
- Reduce onboarding time for new hires who struggle with existing state patterns
- Ensure the chosen solution scales to 15+ developers and 200+ components

### Pain Points

- Team has fragmented state management: Redux in old features, React Query for server state, custom hooks for UI state
- Each approach requires different mental models, increasing cognitive load and onboarding friction
- Needs to justify technical decisions to product leadership with concrete metrics and demos
- Previous evaluation of XState resulted in two rejected proposals because "too complex for team adoption"

### Behaviors

- Creates comparison spreadsheets for library evaluation
- Runs proof-of-concept projects before recommending adoption
- Delegates hands-on evaluation to senior engineers but makes final decisions based on team fit
- Comfortable with TypeScript but prefers solutions that don't require deep type system expertise from all team members

> "If I need to schedule a training session to use it, it's not ready for my team."

---

# User Journey Maps

## Journey 1: First-Time Viz Exploration

**Goal:** Discover, install, and successfully render a first state machine visualization

**Entry Point:** Developer sees Mantaq mentioned in a blog post, conference talk, or peer recommendation

**Success Criteria:** A visible, interactive state graph rendered in the browser showing a simple login flow with clickable transitions

### Journey Steps

| Step | Screen/State                                                              | User Action                                                  | Next State                            | Emotion    | Pain Point                                                                      | Opportunity                                                             |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------- | ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | **Discovery** — Developer reads about Mantaq as XState alternative        | Clicks link to GitHub/npm/docs                               | Landing page / README                 | Curious    | No social proof (stars, downloads) visible immediately                          | Add badges, testimonial quotes, or comparison table at top              |
| 2    | **Evaluation** — Reads README, scans feature list                         | Looks for viz package mention                                | Package listing for @mantaq/viz       | Neutral    | Viz features listed but no live demo link; "interactive" is abstract            | Embed a sandbox preview or link to playground directly in README        |
| 3    | **Installation** — Runs `npm install @mantaq/viz` or `vp install`         | Copies install command, runs in terminal                     | Terminal output, package.json updated | Neutral    | May not know if peer dependencies needed                                        | Post-install script showing "getting started" command                   |
| 4    | **First Code** — Writes minimal viz component in a test file or demo page | Creates new file, imports viz, renders with a sample machine | Empty page or console error           | Confused   | Export names don't match documented API; import path unclear                    | Auto-generate import examples; validate API docs against actual exports |
| 5    | **Debugging Import** — Fixes import to match actual exports               | Reads error, adjusts import path                             | Viz renders but shows nothing         | Frustrated | Red arrows appear with no explanation; error swallowed silently                 | Show inline error state in viz with actionable message                  |
| 6    | **First Render** — Viz component renders a state graph                    | Sees graph, clicks a transition                              | State highlights, graph updates       | Delighted  | Tooltips may not appear on first click; context panel empty for simple machines | Default to showing node labels; add "hello world" context example       |
| 7    | **Exploration** — Tries clicking more nodes, adjusting layout             | Interacts with layout controls                               | Graph re-renders with new layout      | Delighted  | Full re-create on interaction causes flicker; layout options unclear            | Add debounced transitions; show layout option tooltips                  |

### Recovery Paths

- **Import error:** Developer searches GitHub issues, finds nothing, opens a new issue with error message
- **Silent failure:** Developer adds console.log to machine, eventually discovers guard condition issue via manual inspection
- **Layout issues:** Developer adjusts settings until graph looks reasonable, never discovers all options

---

## Journey 2: Debugging a State Machine Issue with Viz

**Goal:** Use Mantaq viz to diagnose why a multi-step form state machine isn't transitioning correctly

**Entry Point:** Developer has an existing state machine (built with Mantaq or ported from another library) that produces unexpected behavior in production

**Success Criteria:** Identify the specific guard condition or effect that causes incorrect transitions, fix it, and verify the fix in the visualizer

### Journey Steps

| Step | Screen/State                                                                       | User Action                                                             | Next State                                   | Emotion    | Pain Point                                                                                   | Opportunity                                                                       |
| ---- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1    | **Reproduction** — Developer has the bug report, opens the relevant component file | Reads error logs, identifies which state machine is involved            | Code editor with machine definition          | Frustrated | State machine is embedded in component code, hard to isolate                                 | Provide "extract machine" utility or copy-pasteable viz config                    |
| 2    | **Viz Integration** — Adds `@mantaq/viz` component to debug view                   | Imports viz, renders machine in a debug page                            | Viz renders with current machine             | Neutral    | May not know how to pass context to viz; API unclear                                         | Add `debugMode` prop that auto-configures for inspection                          |
| 3    | **Graph Analysis** — Examines the rendered state graph                             | Clicks nodes, reads transitions, looks for the broken path              | Context viewer shows current state           | Frustrated | Arrays and functions in context are invisible; context panel shows `[Array]` or `[Function]` | Show array length, function names, or expandable tree for complex values          |
| 4    | **Transition Testing** — Manually triggers transitions to reproduce bug            | Clicks through the happy path until the broken transition               | Red dashed arrow appears (undetermined edge) | Confused   | No tooltip explaining why edge is undetermined; no error message                             | Add hover tooltip: "This transition requires [condition]. Condition not met."     |
| 5    | **Guard Inspection** — Examines the guard condition causing the issue              | Reads machine source code alongside viz, correlates red edge with guard | Identifies the exact condition               | Neutral    | Guard logic is opaque; viz doesn't show guard evaluation result                              | Show guard result on hover: "guard: formIsValid → false (field 'email' is empty)" |
| 6    | **Fix Application** — Modifies the guard condition or adds missing transition      | Edits machine code, saves file                                          | Viz auto-syncs, red edge disappears          | Delighted  | Auto-sync may flicker or cause full re-create; no diff view of what changed                  | Animate transition change; show "last change" indicator                           |
| 7    | **Verification** — Runs through full happy path and edge cases                     | Clicks through all paths, checks context updates                        | All transitions green, context accurate      | Delighted  | No export or share capability; can't send viz state to teammate                              | Add "copy state snapshot" or "export debug session" feature                       |

### Recovery Paths

- **Viz doesn't load:** Developer falls back to console.log debugging, abandons viz for this session
- **Context viewer insufficient:** Developer adds manual logging inside machine actions to see runtime values
- **Auto-sync breaks:** Developer manually refreshes the page, loses current state context

---

## Summary: Key Friction Points Across Both Journeys

| Friction                                          | Journey 1 Impact          | Journey 2 Impact                | Priority     |
| ------------------------------------------------- | ------------------------- | ------------------------------- | ------------ |
| API mismatch (exports vs docs)                    | Blocks first render       | Blocks viz integration          | **Critical** |
| Silent error swallowing                           | Confuses first impression | Obscures root cause             | **Critical** |
| Context viewer limitations                        | Minor for simple machines | Major for debugging             | High         |
| Full re-create on interaction                     | Flicker, feels unpolished | Disrupts debug flow             | High         |
| Missing features (documented but not implemented) | Trust erosion             | Trust erosion                   | High         |
| No inline error guidance                          | Developer gives up        | Developer falls back to logging | Medium       |
