/** App code that connects the sender to the receiver. */
import { poke, receiver, receiverActor, take } from "./receiver.ts";
import type { receiverMachine } from "./receiver.ts";
import { senderActor } from "./sender.ts";
import type { sender } from "./sender.ts";

function onOutput(
  actor: ReturnType<typeof sender.create>,
  listener: (output: { type: string }) => void,
): void {
  actor.on("output", { fn: listener });
}

onOutput(senderActor, (e) => {
  if (e.type === "handedOver") receiver.take();
});

function hop() {
  receiverActor.send(poke.create());
}

function relay() {
  hop();
}

senderActor.on("change", { fn: () => relay() });

export function wire(
  s: ReturnType<typeof sender.create>,
  r: ReturnType<typeof receiverMachine.create>,
) {
  s.on("output", { fn: () => r.send(take.create()) });
}
