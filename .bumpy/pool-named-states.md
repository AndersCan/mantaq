---
"@mantaq/sugar": minor
---

The pool inbox has three named states, `allWorkersFree`, `workersBusy` and `workWaiting`, each handling only the events that can reach it. The `ITEMS_RETURNED` event, which a pool never sent, is gone.

Breaking: the pool inbox's states are allWorkersFree, workersBusy and workWaiting (were empty and holding); PoolEvents has no ITEMS_RETURNED and a running worker no longer hands back an assignment — affects code that reads pool.actor.state.name, uses events.ITEMS_RETURNED, or sends ITEMS_FINISHED itself.
