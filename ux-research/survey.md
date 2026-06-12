# Mantaq UX Research Survey

**Target:** ~10-15 minutes | **Format:** Online form (Typeform/Google Forms compatible)
**Goal:** Understand user needs, pain points, and adoption drivers for Mantaq and @mantaq/viz.

---

## Section 1: Demographics & Role

### Q1.1 — What best describes your primary role?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Frontend developer
- [ ] Full-stack developer
- [ ] Backend developer
- [ ] Engineering manager / Tech lead
- [ ] Library / framework author
- [ ] Educator / Instructor
- [ ] Student / Learner
- [ ] Designer (technical)
- [ ] Other: \***\*\_\_\_\*\***

### Q1.2 — How many years of professional development experience?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Less than 1 year
- [ ] 1–3 years
- [ ] 4–7 years
- [ ] 8–12 years
- [ ] 13+ years

### Q1.3 — What is the primary language/framework you work with?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] TypeScript / JavaScript (React)
- [ ] TypeScript / JavaScript (Vue)
- [ ] TypeScript / JavaScript (Angular)
- [ ] TypeScript / JavaScript (Svelte)
- [ ] TypeScript / JavaScript (Node.js / backend)
- [ ] TypeScript / JavaScript (other framework)
- [ ] Other: \***\*\_\_\_\*\***

### Q1.4 — How large is your team?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Solo / freelancer
- [ ] 2–5 people
- [ ] 6–15 people
- [ ] 16–50 people
- [ ] 50+ people

### Q1.5 — What type of product do you primarily work on?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Consumer-facing web app
- [ ] Internal/business tool
- [ ] Mobile app (React Native / Expo)
- [ ] Open-source library or framework
- [ ] Developer tooling
- [ ] E-commerce
- [ ] Other: \***\*\_\_\_\*\***

### Q1.6 — How did you first hear about Mantaq? _(optional)_

**Type:** Open text | **Required:** No

```
[Short text — 1-2 sentences]
```

---

## Section 2: Current State Management

### Q2.1 — What do you currently use for state management in your projects?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] React useState / useReducer
- [ ] Zustand
- [ ] Jotai / Recoil
- [ ] Redux / Redux Toolkit
- [ ] XState / xstate
- [ ] Immer
- [ ] MobX
- [ ] Signals (TC39 / framework-native)
- [ ] Server state: TanStack Query / SWR
- [ ] Custom state machine implementation
- [ ] None — vanilla JS/TS
- [ ] Other: \***\*\_\_\_\*\***

### Q2.2 — For the state management approach you use most, how satisfied are you?

**Type:** Likert scale (1–5) | **Required:** Yes

| 1                 | 2                     | 3       | 4                  | 5              |
| ----------------- | --------------------- | ------- | ------------------ | -------------- |
| Very dissatisfied | Somewhat dissatisfied | Neutral | Somewhat satisfied | Very satisfied |

### Q2.3 — How often do you encounter bugs related to state management?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Daily
- [ ] Weekly
- [ ] A few times per month
- [ ] Rarely
- [ ] Never

### Q2.4 — What is the most frustrating aspect of your current state management approach?

**Type:** Open text | **Required:** No

```
[Short text — 1-3 sentences]
```

### Q2.5 — How confident are you that your application's state transitions are correct at any given time?

**Type:** Likert scale (1–5) | **Required:** Yes

| 1                    | 2                  | 3                    | 4              | 5                   |
| -------------------- | ------------------ | -------------------- | -------------- | ------------------- |
| Not confident at all | Slightly confident | Moderately confident | Very confident | Extremely confident |

### Q2.6 — How often do state-related bugs reach production?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Frequently (multiple times per month)
- [ ] Occasionally (a few times per quarter)
- [ ] Rarely (once or twice a year)
- [ ] Almost never
- [ ] I don't know

### Q2.7 — Rate the following pain points with your current state management:

**Type:** Matrix (Likert 1–5, rows = pain points) | **Required:** Yes

_1 = Not a problem, 5 = Major problem_

|                                       | 1   | 2   | 3   | 4   | 5   |
| ------------------------------------- | --- | --- | --- | --- | --- |
| Hard to reason about state at runtime | ○   | ○   | ○   | ○   | ○   |
| Debugging state transitions is slow   | ○   | ○   | ○   | ○   | ○   |
| Too much boilerplate code             | ○   | ○   | ○   | ○   | ○   |
| Difficult to visualize state flow     | ○   | ○   | ○   | ○   | ○   |
| Hard to test edge cases               | ○   | ○   | ○   | ○   | ○   |
| Poor developer experience / DX        | ○   | ○   | ○   | ○   | ○   |
| Overkill / too complex for my needs   | ○   | ○   | ○   | ○   | ○   |

### Q2.8 — Have you used a formal state machine library before?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Yes, XState v4
- [ ] Yes, XState v5
- [ ] Yes, Robot (by Matt Brandly)
- [ ] Yes, Stately.ai / Stately Studio
- [ ] Yes, other: \***\*\_\_\_\*\***
- [ ] No, never
- [ ] I've built my own

---

## Section 3: State Machine Experience

### Q3.1 — How would you rate your understanding of finite state machines (FSMs) and statecharts?

**Type:** Likert scale (1–5) | **Required:** Yes

| 1          | 2                   | 3                     | 4                           | 5      |
| ---------- | ------------------- | --------------------- | --------------------------- | ------ |
| No concept | Basic understanding | Comfortable with FSMs | Proficient with statecharts | Expert |

### Q3.2 — In which contexts do you use (or would you use) state machines?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] UI component state (modals, toggles, tabs)
- [ ] Multi-step flows (wizards, onboarding)
- [ ] Form validation logic
- [ ] API request lifecycle (loading/error/success)
- [ ] Game logic
- [ ] Workflow / orchestration
- [ ] Business process modeling
- [ ] Real-time systems (WebSockets, event-driven)
- [ ] Other: \***\*\_\_\_\*\***

### Q3.3 — What prevents you from using state machines more often? _(select all that apply)_

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] Too much boilerplate / ceremony to set up
- [ ] Hard to learn / steep learning curve
- [ ] Don't see the benefit over simpler approaches
- [ ] Library feels too heavy / large bundle size
- [ ] Hard to integrate with existing codebase
- [ ] No good visualization / debugging tools
- [ ] Team unfamiliar / resistant to adoption
- [ ] Nothing — I use them regularly
- [ ] Other: \***\*\_\_\_\*\***

### Q3.4 — How important are the following features in a state machine library?

**Type:** Matrix (Likert 1–5, rows = features) | **Required:** Yes

_1 = Not important, 5 = Critical_

|                                   | 1   | 2   | 3   | 4   | 5   |
| --------------------------------- | --- | --- | --- | --- | --- |
| TypeScript-first type safety      | ○   | ○   | ○   | ○   | ○   |
| Small bundle size                 | ○   | ○   | ○   | ○   | ○   |
| Visual graph / diagram generation | ○   | ○   | ○   | ○   | ○   |
| Integrated devtools / debugger    | ○   | ○   | ○   | ○   | ○   |
| Framework-agnostic (vanilla JS)   | ○   | ○   | ○   | ○   | ○   |
| Parallel states / hierarchies     | ○   | ○   | ○   | ○   | ○   |
| Actions / guards / services       | ○   | ○   | ○   | ○   | ○   |
| Easy testing utilities            | ○   | ○   | ○   | ○   | ○   |

### Q3.5 — How do you currently document or communicate state machine designs to your team?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] We don't — it's implicit / tribal knowledge
- [ ] Comments in code
- [ ] ASCII art / text diagrams
- [ ] Mermaid diagrams
- [ ] Stately Studio / visual editor
- [ ] Figma / whiteboard screenshots
- [ ] Written documentation (Markdown/Confluence)
- [ ] Other: \***\*\_\_\_\*\***

### Q3.6 — Would you describe your team's adoption of state machines as:

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Not adopted — we haven't explored them
- [ ] Experimental — tried in a few places
- [ ] Growing — actively expanding usage
- [ ] Standard — our default approach for complex state
- [ ] Mature — fully integrated into our workflow

---

## Section 4: Visualization Needs

### Q4.1 — How useful would a state machine visualization tool be for your workflow?

**Type:** Likert scale (1–5) | **Required:** Yes

| 1          | 2               | 3                 | 4           | 5         |
| ---------- | --------------- | ----------------- | ----------- | --------- |
| Not useful | Slightly useful | Moderately useful | Very useful | Essential |

### Q4.2 — What visualization features are most important to you?

**Type:** Ranking | **Required:** Yes

_Rank from 1 (most important) to 8 (least important):_

- [ ] Interactive graph with clickable transitions
- [ ] Live state highlighting (current state glows)
- [ ] Context/data panel showing current context values
- [ ] Transition history / timeline view
- [ ] Export as SVG/PNG for documentation
- [ ] Code generation from visual diagram
- [ ] Multiple layout options (force-directed, hierarchical, etc.)
- [ ] Dark mode / theming

### Q4.3 — Where would you expect to use a state machine visualization tool?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] In the browser (dev server overlay)
- [ ] As a standalone desktop app
- [ ] As a VS Code extension
- [ ] Embedded in my application (for end users)
- [ ] In CI/CD pipeline (static analysis)
- [ ] In documentation / README
- [ ] Other: \***\*\_\_\_\*\***

### Q4.4 — How important is it that the visualization tool supports statecharts (hierarchical / parallel states) vs simple FSMs only?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Must support full statecharts (parallel, history, etc.)
- [ ] Simple FSM support is sufficient for my needs
- [ ] Both are important — I use different complexity levels
- [ ] I don't know the difference

### Q4.5 — Rate the importance of the following visualization characteristics:

**Type:** Matrix (Likert 1–5, rows = characteristics) | **Required:** Yes

_1 = Not important, 5 = Critical_

|                                       | 1   | 2   | 3   | 4   | 5   |
| ------------------------------------- | --- | --- | --- | --- | --- |
| Zero-config / works out of the box    | ○   | ○   | ○   | ○   | ○   |
| Minimal performance overhead          | ○   | ○   | ○   | ○   | ○   |
| Supports large graphs (50+ states)    | ○   | ○   | ○   | ○   | ○   |
| Responsive / works on mobile          | ○   | ○   | ○   | ○   | ○   |
| Embeddable in custom tools            | ○   | ○   | ○   | ○   | ○   |
| Real-time sync with running app state | ○   | ○   | ○   | ○   | ○   |

### Q4.6 — What would make you NOT use a visualization tool?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] Too slow / laggy with complex machines
- [ ] Requires too much configuration
- [ ] Incompatible with my framework
- [ ] Proprietary / not open source
- [ ] Doesn't integrate with my devtools
- [ ] Too expensive
- [ ] Nothing — I'd try any good tool
- [ ] Other: \***\*\_\_\_\*\***

### Q4.7 — How do you currently create state machine diagrams?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] I don't create diagrams
- [ ] Hand-drawn (whiteboard / pen & paper)
- [ ] Figma / design tool
- [ ] Mermaid in Markdown
- [ ] PlantUML
- [ ] Graphviz / DOT
- [ ] Stately Studio
- [ ] Code-generated (auto from library)
- [ ] Other: \***\*\_\_\_\*\***

### Q4.8 — Would you use a visualization tool that auto-generates diagrams from your state machine code?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Yes, that would be my primary use case
- [ ] Yes, but I'd also want manual editing
- [ ] Maybe — depends on diagram quality
- [ ] No, I prefer manual control
- [ ] I don't need diagrams

### Q4.9 — How important is it that diagrams are always in sync with the actual code?

**Type:** Likert scale (1–5) | **Required:** Yes

| 1             | 2                  | 3                    | 4              | 5                             |
| ------------- | ------------------ | -------------------- | -------------- | ----------------------------- |
| Not important | Slightly important | Moderately important | Very important | Critical — dealbreaker if not |

### Q4.10 — _(optional)_ Describe your ideal state machine visualization tool in a few sentences.

**Type:** Open text | **Required:** No

```
[Short text — 2-4 sentences]
```

---

## Section 5: Debugging Workflow

### Q5.1 — How do you currently debug state-related issues?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] console.log / console.table
- [ ] Browser DevTools (breakpoints)
- [ ] VS Code debugger
- [ ] Redux DevTools / Zustand devtools
- [ ] XState Inspector
- [ ] Custom logging / tracing
- [ ] Automated tests (unit / integration)
- [ ] Rubber duck debugging
- [ ] I don't have a systematic approach
- [ ] Other: \***\*\_\_\_\*\***

### Q5.2 — How long does it typically take you to diagnose a state-related bug?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Minutes (< 15 min)
- [ ] 15–60 minutes
- [ ] 1–4 hours
- [ ] Half a day or more
- [ ] Varies widely

### Q5.3 — What is the hardest part of debugging state issues?

**Type:** Open text | **Required:** No

```
[Short text — 1-3 sentences]
```

### Q5.4 — Rate how helpful each debugging approach is for you:

**Type:** Matrix (Likert 1–5, rows = approaches) | **Required:** Yes

_1 = Not helpful, 5 = Extremely helpful_

|                                                 | 1   | 2   | 3   | 4   | 5   |
| ----------------------------------------------- | --- | --- | --- | --- | --- |
| Visual state graph showing current position     | ○   | ○   | ○   | ○   | ○   |
| Transition history / timeline                   | ○   | ○   | ○   | ○   | ○   |
| Context values inspector                        | ○   | ○   | ○   | ○   | ○   |
| Step-through / time-travel debugging            | ○   | ○   | ○   | ○   | ○   |
| Predictive analysis ("what would happen if...") | ○   | ○   | ○   | ○   | ○   |
| Automated state coverage reports                | ○   | ○   | ○   | ○   | ○   |

### Q5.5 — Would a "time-travel" feature (step forward/backward through state transitions) be valuable?

**Type:** Likert scale (1–5) | **Required:** Yes

| 1            | 2                 | 3                   | 4             | 5         |
| ------------ | ----------------- | ------------------- | ------------- | --------- |
| Not valuable | Slightly valuable | Moderately valuable | Very valuable | Essential |

---

## Section 6: Discovery & Evaluation

### Q6.1 — How do you typically discover new frontend libraries?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] Hacker News
- [ ] Reddit (r/javascript, r/reactjs, etc.)
- [ ] Twitter / X
- [ ] YouTube tutorials / reviews
- [ ] Blog posts / Medium / Dev.to
- [ ] GitHub trending
- [ ] npm search / bundlephobia
- [ ] Conference talks
- [ ] Word of mouth / colleagues
- [ ] Podcasts
- [ ] Other: \***\*\_\_\_\*\***

### Q6.2 — What factors most influence your decision to adopt a new library?

**Type:** Ranking | **Required:** Yes

_Rank from 1 (most influential) to 7 (least influential):_

- [ ] Bundle size / performance
- [ ] TypeScript support / type safety
- [ ] Documentation quality
- [ ] Community size / GitHub stars
- [ ] Maintenance activity / responsiveness
- [ ] Learning curve / ease of adoption
- [ ] Alignment with team skills

### Q6.3 — How important are the following when evaluating a state machine library?

**Type:** Matrix (Likert 1–5, rows = factors) | **Required:** Yes

_1 = Not important, 5 = Critical_

|                                           | 1   | 2   | 3   | 4   | 5   |
| ----------------------------------------- | --- | --- | --- | --- | --- |
| Works with my existing stack              | ○   | ○   | ○   | ○   | ○   |
| Has active community / ecosystem          | ○   | ○   | ○   | ○   | ○   |
| Backed by a company / sustainable funding | ○   | ○   | ○   | ○   | ○   |
| Good error messages                       | ○   | ○   | ○   | ○   | ○   |
| Migration path from current solution      | ○   | ○   | ○   | ○   | ○   |
| Example projects / templates available    | ○   | ○   | ○   | ○   | ○   |

### Q6.4 — What would make you try Mantaq over a more established alternative like XState?

**Type:** Open text | **Required:** No

```
[Short text — 2-3 sentences]
```

### Q6.5 — What is your typical evaluation process for a new library? _(select the first step you'd take)_

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Read the README / docs
- [ ] Try a hello-world example immediately
- [ ] Check bundle size on bundlephobia
- [ ] Look at GitHub issues / activity
- [ ] Search for comparisons / benchmarks
- [ ] Ask colleagues or community
- [ ] Wait for others to try it first

---

## Section 7: Pricing & Support

### Q7.1 — Would you pay for a premium version of Mantaq that includes advanced features (e.g., cloud collaboration, advanced viz, team features)?

**Type:** Multiple choice (single select) | **Required:** Yes

- [ ] Yes, I'd pay for individual use
- [ ] Yes, my company would pay for team use
- [ ] Maybe — depends on the price and features
- [ ] No — I only use free / open-source tools
- [ ] I'd prefer a freemium model (free core + paid extras)

### Q7.2 — If Mantaq had a paid tier, what price range would be reasonable?

**Type:** Multiple choice (single select) | **Required:** Yes _(if Q7.1 = Yes/Maybe)_

- [ ] Free only (no paid tier)
- [ ] $5–10/month (individual)
- [ ] $10–20/month (individual)
- [ ] $20–50/month (individual)
- [ ] $50+/month (individual)
- [ ] $5–15/user/month (team)
- [ ] $15–30/user/month (team)
- [ ] One-time purchase: $50–100
- [ ] One-time purchase: $100–250
- [ ] One-time purchase: $250+

### Q7.3 — What support channels matter most to you?

**Type:** Ranking | **Required:** Yes

_Rank from 1 (most important) to 5 (least important):_

- [ ] Comprehensive documentation
- [ ] GitHub Issues / Discussions
- [ ] Discord / Slack community
- [ ] Email support
- [ ] Video tutorials / courses

### Q7.4 — Would you be interested in any of the following Mantaq ecosystem additions?

**Type:** Multiple choice (multi-select) | **Required:** Yes

- [ ] Mantaq Pro — advanced devtools (time-travel, coverage)
- [ ] Mantaq Cloud — hosted collaboration & state visualization
- [ ] Mantaq CLI — scaffolding and code generation
- [ ] Mantaq Testing — assertion library for state machines
- [ ] Enterprise support / consulting
- [ ] None — the core library is enough
- [ ] Other: \***\*\_\_\_\*\***

---

## Closing

### Q7.5 — Would you be open to a 15-minute follow-up interview about your state machine workflow?

**Type:** Multiple choice (single select) | **Required:** No

- [ ] Yes — include my email below
- [ ] Maybe — I'd consider it
- [ ] No thanks

**If yes/maybe:**

```
Email: [Short text]
```

### Q7.6 — Any final thoughts or feedback on Mantaq?

**Type:** Open text | **Required:** No

```
[Short text — freeform]
```

---

## Survey Metadata

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Estimated time     | 10–15 minutes                                            |
| Total questions    | 35                                                       |
| Required questions | 28                                                       |
| Optional questions | 7                                                        |
| Response types     | Multiple choice: 18, Likert: 8, Ranking: 4, Open text: 5 |
| Target sample      | 50–200 respondents across 5 segments                     |

### Recommended Distribution Strategy

1. **State Machine Converts** — Post in XState Discord, r/reactjs, TypeScript Discord
2. **Frontend Debuggers** — Dev.to article, Twitter thread, Reactiflux
3. **Library Authors** — GitHub outreach, Open-source collectives
4. **Teams Adopting** — LinkedIn, engineering blogs, conference meetups
5. **Educators/Learners** — Egghead, Frontend Masters community, university CS channels
