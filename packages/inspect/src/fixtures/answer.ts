/**
 * Ask, then answer: the answer only counts when its code is the one the
 * machine is waiting on. Meant for the live page's "Values from" form.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const noAskYet = state("noAskYet")();
const waitingForAnswer = state("waitingForAnswer")<{ code: string; album: string }>();
const accepted = state("accepted")();
const declined = state("declined")();

const ask = event("ask")<{ code: string; album: string }>();
const answered = event("answered")<{ code: string; answer: "accepted" | "declined" }>();

export function createAnswerActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [ask, answered],
    states: [noAskYet, waitingForAnswer, accepted, declined],
    initial: noAskYet,
    clock,
    setup: (m) => {
      m.on(noAskYet, {
        event: ask,
        to: [waitingForAnswer],
        handler: (event) => ({ state: waitingForAnswer, payload: event.payload }),
      });
      m.on(waitingForAnswer, {
        event: answered,
        to: [accepted, declined],
        handler: (event, { state: current }) => {
          if (event.payload.code !== current.payload.code) return {};
          return { state: event.payload.answer === "accepted" ? accepted : declined };
        },
      });
    },
  });
}
