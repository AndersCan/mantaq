---
"@mantaq/inspect": minor
---

`recordRuns` replays a test that passes options besides `clock` the way the page does, with only `{ clock }`, and fails the test when it ends elsewhere, naming the options. Breaking: such a test used to pass while its run was left off the page; build its actor with only the clock, or give the factory defaults that act like those options.
