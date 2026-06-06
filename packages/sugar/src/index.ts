export { matches } from "./actors/matches.ts";
export { states } from "./state.ts";
export { events } from "./event.ts";
export { onSuccess, onError, withPromise } from "./effects/promise.ts";
export { withTimeout } from "./effects/timeout.ts";
export { broadcast } from "./transitions/broadcast.ts";
export { tag } from "./tags.ts";

// TODO: Move ActorMap from @mantaq/core to @mantaq/sugar
// - Implement ActorMap class (dynamic child actor manager)
// - Factory-based spawn, send, kill, ensure methods
// - Wire child→parent output handlers
// - Add tests
