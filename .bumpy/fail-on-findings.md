---
"@mantaq/inspect": minor
---

`mantaqViz({ failOnFindings: true })` makes `astro build` fail on any design finding, a machine that could not be fuzzed, or an expectation that is not checked, listing each with the events that lead there. `astro dev` is unchanged. `expectNoDesignErrors` now prints the `after:` path for every finding that has one. Breaking: none.
