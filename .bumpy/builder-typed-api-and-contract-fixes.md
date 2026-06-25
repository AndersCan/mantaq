---
"@mantaq/core": major
"@mantaq/sugar": patch
---

Re-introduced ActorBuilder as the one-way typed API (setup callback). Dropped direct transitions/effects map from public ActorOptions. Removed IS_DEV flag and utils.ts — warnings now unconditional. Effect errors propagate to caller (removed try/catch swallow). send() accepts input events only; final-state send is silent noop. Internal queue routing via private #dispatch.
