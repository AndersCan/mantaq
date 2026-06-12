# Mantaq User Interview Script

## Logistics

- **Duration**: 45-60 minutes
- **Format**: Remote (video call preferred, audio-only acceptable)
- **Incentive**: $50-75 gift card (or equivalent) for completed interviews
- **Recording**: Screen + audio recording with written consent required
- **Participants**: 5-7 per segment, aim for 25-35 total interviews

### Recording Consent Script

> Before we start, I want to confirm: this session will be recorded (audio and screen) for research purposes only. Recordings won't be shared publicly and will only be used by our team to identify patterns. You can stop recording at any time. Do I have your consent to record?

---

## Facilitator Notes

- **Listen more, talk less.** Target 80/20 ratio (participant/facilitator).
- **Ask "why" relentlessly.** First answer is rarely the real insight.
- **Avoid leading questions.** Don't say "Isn't XState hard to debug?" Say "Walk me through debugging a bug in your state machine."
- **Capture exact quotes.** They're gold for synthesis and stakeholder buy-in.
- **Note non-verbal cues.** Hesitation, excitement, confusion — all data.
- **Time-box aggressively.** Pre-screen: 5 min. Core: 30 min. Viz: 15 min. Wrap: 5 min.
- **Have Mantaq viz ready to demo** but don't show until viz questions begin.

---

## Pre-Screen Questions (5-7 min)

Goal: Qualify participant, assign segment, establish baseline.

### P1. Role & Experience

**Q: "What's your role and how long have you been working with frontend development?"**

- Follow-up: "What kind of apps do you work on primarily?"
- **Learning**: Experience level, domain context, whether they hit complexity thresholds where state machines matter.

### P2. State Management Awareness

**Q: "What state management approach do you currently use in your projects?"**

- Follow-up: "Have you ever used a state machine library like XState, Robot, or State.js?"
- Follow-up: "If yes, which one and for how long? If no, why not?"
- **Learning**: Segment assignment. Detects converts vs. newcomers.

### P3. Problem Awareness

**Q: "Think about the last time you had a tricky bug related to UI state. Can you describe it briefly?"**

- Follow-up: "How long did it take to resolve?"
- **Learning**: Whether they experience pain points that state machines solve. Severity of debugging struggles.

### P4. Visualization Familiarity

**Q: "Have you ever used a visual tool to inspect or debug state machines?"**

- Follow-up: "If yes, what tool? If no, how did you understand the state machine's behavior?"
- **Learning**: Baseline for viz questions. Whether they've seen state machine visualization before.

### P5. Decision-Making Role

**Q: "When your team adopts a new library, what's your involvement in that decision?"**

- Follow-up: "Are you typically the one proposing tools, or do you follow team decisions?"
- **Learning**: Whether they're an influencer or adopter. Matters for go-to-market.

### P6. Segment Assignment (Internal — Do Not Read)

Based on answers, assign one of:

1. **State Machine Convert** — Currently uses XState or similar
2. **Frontend Debugger** — Struggles with complex UI state bugs
3. **Library Author** — Builds tools/frameworks on top of state machines
4. **Teams Adopting** — Team considering state machines, new to formal approach
5. **Educator/Learner** — Teaching or learning state machine concepts

### P7. Comfort Level

**Q: "On a scale of 1-5, how comfortable are you with TypeScript and type systems?"**

- **Learning**: Whether they'll care about type inference, generics, type safety. Informs how deep to go on API questions.

---

## Core Interview Questions (30 min)

### Theme 1: Current State Management Practices

#### Q1. "Walk me through how you currently manage state in a typical project."

- Follow-up: "What does your state architecture look like in a mid-size feature?"
- Follow-up: "How do you decide what goes in global vs. local state?"
- **Learning**: Actual workflows, not theoretical preferences. Reveals whether they already structure state formally or use ad-hoc approaches.

#### Q2. "How do you handle state that involves async operations or side effects?"

- Follow-up: "Do you use effects, actions, or some other pattern?"
- Follow-up: "How do you test those side effects?"
- **Learning**: Whether async/effect handling is a pain point. Reveals testing gaps.

#### Q3. "When you're working with a new codebase, how do you understand its state management?"

- Follow-up: "What do you look at first?"
- Follow-up: "How long does it typically take you to feel confident about the state flow?"
- **Learning**: Onboarding friction. Direct need for visualization/documentation tools.

### Theme 2: Pain Points with Existing Solutions

#### Q4. "What frustrates you most about your current state management approach?"

- Follow-up: "Can you give a specific example where it failed you?"
- Follow-up: "What did you try to work around it?"
- **Learning**: Unmet needs. This is where Mantaq opportunities live.

#### Q5. "If you use XState (or similar): what made you choose it, and what made you consider alternatives?"

- Follow-up: "What would make you switch?"
- Follow-up: "What's the one thing you wish it did differently?"
- **Learning**: Competitive intelligence. Switching triggers and barriers.

#### Q6. "Describe a time when debugging a state-related bug was especially painful."

- Follow-up: "What tools did you use during that debug session?"
- Follow-up: "What would have made it faster?"
- **Learning**: Debugging workflow gaps. Validates need for better tooling.

#### Q7. "How do you document state machines for your team?"

- Follow-up: "Do you maintain diagrams? How often are they accurate?"
- Follow-up: "If they're out of date, what happens?"
- **Learning**: Documentation burden. Diagram drift as a problem Mantaq viz could solve.

### Theme 3: Visualization Needs & Expectations

#### Q8. "When you think about visualizing a state machine, what's the first thing you want to see?"

- Follow-up: "What would make you trust the visualization?"
- Follow-up: "What would make you ignore it?"
- **Learning**: Core viz requirements. Trust signals. Avoidance patterns.

#### Q9. "How would you use a state machine visualization in your daily workflow?"

- Follow-up: "During development? During code review? During debugging? All three?"
- Follow-up: "Would you share visualizations with non-technical teammates?"
- **Learning**: Use case prioritization. Collaboration angle.

#### Q10. "What information would you want to interact with in a visualization?"

- Follow-up: "Would you click on states? Transitions? Context values?"
- Follow-up: "What would hovering or clicking reveal?"
- **Learning**: Interaction model preferences. Feature prioritization.

#### Q11. "How important is it that the visualization stays in sync with the actual code?"

- Follow-up: "If it could drift, would you still use it?"
- Follow-up: "What's the maximum acceptable drift?"
- **Learning**: Sync fidelity requirements. Tolerance for stale visualizations.

### Theme 4: Debugging Workflows

#### Q12. "Walk me through your typical debugging process when something goes wrong in a state machine."

- Follow-up: "What breakpoints do you set? Where?"
- Follow-up: "How do you track state transitions over time?"
- **Learning**: Current debug workflow. Points of friction.

#### Q13. "What would your ideal state machine debugging session look like?"

- Follow-up: "What information would be on screen?"
- Follow-up: "What actions would you take?"
- **Learning**: Dream state. Reveals unarticulated needs.

#### Q14. "Do you currently log or trace state transitions? How?"

- Follow-up: "Is that sufficient?"
- Follow-up: "What's missing from your current logging?"
- **Learning**: Observability gaps. Logging as proxy for viz.

#### Q15. "When debugging with a team, how do you share what you've found about state behavior?"

- Follow-up: "Screenshots? Screen sharing? Diagrams?"
- **Learning**: Collaboration needs. Whether viz should support sharing/export.

### Theme 5: Discovery & Evaluation Criteria

#### Q16. "How do you typically discover new frontend libraries?"

- Follow-up: "Twitter/X? HN? Blog posts? npm search? Conference talks?"
- Follow-up: "What makes you actually try something vs. just star it?"
- **Learning**: Go-to-market channel optimization.

#### Q17. "What's your evaluation process when considering a new state management library?"

- Follow-up: "What do you look at first — docs, GitHub stars, bundle size, TypeScript support?"
- Follow-up: "What's an immediate dealbreaker?"
- Follow-up: "How long do you typically evaluate before deciding?"
- **Learning**: Evaluation criteria. Key differentiators to highlight. Dealbreakers to avoid.

#### Q18. "What would make you recommend a state machine library to a colleague?"

- Follow-up: "What would make you NOT recommend it?"
- **Learning**: Word-of-mouth drivers. Anti-recommendations.

#### Q19. "How important is bundle size, performance, and TypeScript support in your decision?"

- Follow-up: "Do you have minimum requirements?"
- **Learning**: Technical requirements thresholds.

#### Q20. "What would it take for you to migrate an existing project to a new state machine library?"

- Follow-up: "What level of effort is acceptable?"
- Follow-up: "What would need to be true about the new library?"
- **Learning**: Migration barriers. Required confidence level.

---

## Visualization-Specific Questions (15 min)

_Facilitator: Before these questions, show a brief demo of @mantaq/viz. Let them see it for 2-3 minutes, then ask._

### V1. "What's your first reaction to seeing this visualization?"

- Follow-up: "What stands out? What's confusing?"
- Follow-up: "Does this match what you expected?"
- **Learning**: First impressions. Intuitiveness of the UI.

### V2. "How would you use this in your workflow?"

- Follow-up: "Would you use it during development, debugging, documentation, or all three?"
- Follow-up: "Would you keep it open while coding?"
- **Learning**: Integration points. Frequency of use.

### V3. "What would you want to click on?"

- Follow-up: "States? Transitions? Context? Actions?"
- Follow-up: "What should happen when you click a transition?"
- **Learning**: Interaction model. Feature discovery.

### V4. "How would you want to share this with your team?"

- Follow-up: "Export as image? Shareable link? Embed in docs?"
- Follow-up: "Would you put this in a PR description? A Confluence page?"
- **Learning**: Sharing/export requirements. Distribution channels.

### V5. "What layout would you prefer for this graph?"

- Follow-up: "Horizontal? Vertical? Radial? Does it matter?"
- Follow-up: "For a machine with 20+ states, how would you want to navigate it?"
- **Learning**: Layout preferences. Scaling requirements.

### V6. "Would you want to see the context (variables/data) alongside the graph?"

- Follow-up: "If yes, how? Sidebar? Tooltip? Inline on states?"
- Follow-up: "Would you want to edit context values and see the graph react?"
- **Learning**: Context visualization. Interactive editing appetite.

### V7. "How would you want this to integrate with your development environment?"

- Follow-up: "VS Code extension? Browser devtools panel? Standalone app? All three?"
- Follow-up: "Would you want it to auto-open when you save a state machine file?"
- **Learning**: Integration surface. Development ergonomics.

### V8. "What's missing from what you see? What would you add?"

- Follow-up: "If you could wave a magic wand, what feature would you add?"
- **Learning**: Feature requests. Gap analysis.

### V9. "Would this help you onboard onto a new codebase with state machines?"

- Follow-up: "What would make it more useful for onboarding?"
- Follow-up: "Would you generate this during code review?"
- **Learning**: Onboarding value proposition.

### V10. "Compared to reading state machine code, how does this visualization change your understanding?"

- Follow-up: "Does it reveal anything you wouldn't see in code?"
- Follow-up: "Does it hide anything important?"
- **Learning**: Value proposition validation. Completeness concerns.

---

## Wrap-Up Questions (5 min)

### W1. "If you could change one thing about how you work with state machines, what would it be?"

- Follow-up: "Why that one thing?"
- **Learning**: Highest-leverage pain point. Priority signal.

### W2. "Is there anything I didn't ask about that you think is important?"

- **Learning**: Catch blind spots. Participant-driven insights.

### W3. "Would you be interested in trying Mantaq in a real project? Can we follow up?"

- Follow-up: "What would you need to feel comfortable trying it?"
- **Learning**: Conversion potential. Barriers to trial.

### W4. "Who else should we talk to about this?"

- Follow-up: "Anyone on your team who deals with this pain differently?"
- **Learning**: Snowball sampling. New segment discovery.

### W5. "On a scale of 1-10, how likely are you to use a tool like this in the next 6 months?"

- Follow-up: "What would move that number up by 1 point?"
- **Learning**: Quantitative signal. Conversion triggers.

---

## Synthesis Framework

### After Each Interview

1. **Debrief immediately** (5 min): Fill out the synthesis template below.
2. **Tag quotes**: Mark quotes that are surprising, validating, or contradicting.
3. **Update segment notes**: Refine segment definitions if needed.

### Synthesis Template

```markdown
## Interview #[N] — [Date]

**Segment**: [State Machine Convert / Frontend Debugger / Library Author / Teams Adopting / Educator/Learner]
**Role**: [Title]
**Experience**: [Years frontend, tools used]
**Duration**: [Actual time]

### Key Quotes

1. "[exact quote]" — [context]
2. "[exact quote]" — [context]

### Key Insights

- [Insight 1]
- [Insight 2]
- [Insight 3]

### Pain Points (ranked)

1. [Pain 1]
2. [Pain 2]
3. [Pain 3]

### Viz Reactions

- First impression: [reaction]
- Most requested feature: [feature]
- Biggest concern: [concern]

### NPS Score: [1-10]

### Would Try: [Yes/No/Maybe]

### Barriers to Trial: [list]
```

### Cross-Interview Synthesis

After all interviews, create:

1. **Segment Scorecard** — Per-segment pain point frequency, viz feature priority, NPS average.
2. **Insight Map** — Affinity diagram of all insights, grouped by theme.
3. **Quote Wall** — Most compelling quotes organized by segment.
4. **Feature Priority Matrix** — Plot requested features on Impact (y) vs. Frequency (x).
5. **Competitive Positioning** — What XState/Robot users wish was different, what newcomers find intimidating.
6. **Go-to-Market Signals** — Best discovery channels, evaluation criteria, recommendation drivers.

### Decision Criteria

| Signal                | Strong Signal           | Weak Signal                |
| --------------------- | ----------------------- | -------------------------- |
| Pain frequency        | >70% mention same pain  | Pain mentioned once        |
| NPS                   | Average >8              | Average <5                 |
| Would try             | >60% say yes            | <30% say yes               |
| Viz demand            | >80% want viz features  | Viz seen as "nice to have" |
| Migration willingness | >50% willing to migrate | >70% say "too much effort" |
