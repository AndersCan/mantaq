---
"@mantaq/core": patch
---

Fix core clock and effect issues: RealClock.setInterval honors an already-aborted signal (#211); VirtualClock.setDrain supports multiple drains (#230); RealClock.clearTimeout/clearInterval detach their abort listener (#235); settled() awaits effects spawned by other effects (#237); VirtualClock.advance fires every distinct deadline (#238); non-native thenables are treated as async effects (#239).
