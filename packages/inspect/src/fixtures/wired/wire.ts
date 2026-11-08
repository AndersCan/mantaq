/** App code that connects the sender to the receiver. */
import { poke, receiver, receiverActor, take } from "./receiver.ts";
import type { createReceiverActor } from "./receiver.ts";
import { senderActor } from "./sender.ts";
import type { createSenderActor } from "./sender.ts";

function onOutput(
  actor: ReturnType<typeof createSenderActor>,
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
  s: ReturnType<typeof createSenderActor>,
  r: ReturnType<typeof createReceiverActor>,
) {
  s.on("output", { fn: () => r.send(take.create()) });
}
