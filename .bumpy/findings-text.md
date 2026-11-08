---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

Design findings say what is wrong in the machine's own names: a headline, a proof (for an unreachable state, the arrows into it and the states the machine can reach) and a fix. A declared input or internal event that no state handles is now a finding. Naming notes (vague or undocumented names) are flagged as notes.

Breaking: `VizFinding.state` is nullable, and `title`, `proof`, `fix`, `event`, `note` and `noReplay` are new required fields — affects code reading `@mantaq/viz` findings. A declared input or internal event that no state handles is now a design finding — affects `expectNoDesignErrors` and `failOnFindings` on such machines.
