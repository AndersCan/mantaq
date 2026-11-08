---
"@mantaq/inspect": minor
---

`mantaqViz({ failOnFindings: true })` fails `astro build` when a recorded run does not replay on the page. The drop warning now says how to fix it: build the test's actor with only a clock, or give the factory defaults that act like the test's options. Breaking: sites using `failOnFindings` with such a run now fail to build; fix the run as the message says.
