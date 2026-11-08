/** Listeners whose sends the wire finder must skip or label as output. */
import { receiverActor, take } from "../wired/receiver.ts";
import { senderActor } from "../wired/sender.ts";

function third() {
  receiverActor.send(take.create());
}

function second() {
  third();
}

function first() {
  second();
}

senderActor.on("output", { fn: () => first() });

function ping(): void {
  pong();
}

function pong(): void {
  ping();
  receiverActor.send(take.create());
}

senderActor.on("change", { fn: () => ping() });

receiverActor.on("change", { fn: () => receiverActor.send(take.create()) });

function note(): void {}

function probe(): boolean {
  receiverActor.send(take.create());
  return true;
}

senderActor.on("output", {
  fn: (e: { type: string }) => {
    if (e.type === "handedOver" && probe()) {
      note();
    } else {
      receiverActor.send(take.create());
    }
    receiverActor.send(take.create());
  },
});
