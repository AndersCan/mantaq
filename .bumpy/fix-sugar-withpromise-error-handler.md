---
"@mantaq/sugar": patch
---

`withPromise` binds its error handler only to the original promise: the success
and rejection handlers now use the two-argument `then`, so a throw in the
success callback is no longer swallowed and mislabeled as a promise rejection
(#268). A success-path failure now propagates uncaught as it should.
