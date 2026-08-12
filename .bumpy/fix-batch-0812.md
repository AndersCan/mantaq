---
"@mantaq/core": minor
"@mantaq/sugar": patch
"@mantaq/test": patch
"@mantaq/traversal": patch
---

Added actor recovery, transition observability, snapshot state payloads, and hardened clocks against invalid ms; fixed error-report accuracy and made the test harness context-generic. Banned console.* in library src — failures now throw (misconfiguration) or route to the error state (runtime), with platform-matching clock delay clamping.
