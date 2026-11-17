/** A hub with twenty exits, so its graph is taller than a window; has a sibling preview file. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const hub = state("hub")();
const leaf0 = state("leaf0")();
const leaf1 = state("leaf1")();
const leaf2 = state("leaf2")();
const leaf3 = state("leaf3")();
const leaf4 = state("leaf4")();
const leaf5 = state("leaf5")();
const leaf6 = state("leaf6")();
const leaf7 = state("leaf7")();
const leaf8 = state("leaf8")();
const leaf9 = state("leaf9")();
const leaf10 = state("leaf10")();
const leaf11 = state("leaf11")();
const leaf12 = state("leaf12")();
const leaf13 = state("leaf13")();
const leaf14 = state("leaf14")();
const leaf15 = state("leaf15")();
const leaf16 = state("leaf16")();
const leaf17 = state("leaf17")();
const leaf18 = state("leaf18")();
const leaf19 = state("leaf19")();
const go0 = event("go0")();
const go1 = event("go1")();
const go2 = event("go2")();
const go3 = event("go3")();
const go4 = event("go4")();
const go5 = event("go5")();
const go6 = event("go6")();
const go7 = event("go7")();
const go8 = event("go8")();
const go9 = event("go9")();
const go10 = event("go10")();
const go11 = event("go11")();
const go12 = event("go12")();
const go13 = event("go13")();
const go14 = event("go14")();
const go15 = event("go15")();
const go16 = event("go16")();
const go17 = event("go17")();
const go18 = event("go18")();
const go19 = event("go19")();

export function createTallActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [
      go0,
      go1,
      go2,
      go3,
      go4,
      go5,
      go6,
      go7,
      go8,
      go9,
      go10,
      go11,
      go12,
      go13,
      go14,
      go15,
      go16,
      go17,
      go18,
      go19,
    ],
    states: [
      hub,
      leaf0,
      leaf1,
      leaf2,
      leaf3,
      leaf4,
      leaf5,
      leaf6,
      leaf7,
      leaf8,
      leaf9,
      leaf10,
      leaf11,
      leaf12,
      leaf13,
      leaf14,
      leaf15,
      leaf16,
      leaf17,
      leaf18,
      leaf19,
    ],
    initial: hub,
    clock,
    setup: (m) => {
      m.on(hub, { event: go0, to: [leaf0], handler: () => ({ state: leaf0 }) });
      m.on(hub, { event: go1, to: [leaf1], handler: () => ({ state: leaf1 }) });
      m.on(hub, { event: go2, to: [leaf2], handler: () => ({ state: leaf2 }) });
      m.on(hub, { event: go3, to: [leaf3], handler: () => ({ state: leaf3 }) });
      m.on(hub, { event: go4, to: [leaf4], handler: () => ({ state: leaf4 }) });
      m.on(hub, { event: go5, to: [leaf5], handler: () => ({ state: leaf5 }) });
      m.on(hub, { event: go6, to: [leaf6], handler: () => ({ state: leaf6 }) });
      m.on(hub, { event: go7, to: [leaf7], handler: () => ({ state: leaf7 }) });
      m.on(hub, { event: go8, to: [leaf8], handler: () => ({ state: leaf8 }) });
      m.on(hub, { event: go9, to: [leaf9], handler: () => ({ state: leaf9 }) });
      m.on(hub, { event: go10, to: [leaf10], handler: () => ({ state: leaf10 }) });
      m.on(hub, { event: go11, to: [leaf11], handler: () => ({ state: leaf11 }) });
      m.on(hub, { event: go12, to: [leaf12], handler: () => ({ state: leaf12 }) });
      m.on(hub, { event: go13, to: [leaf13], handler: () => ({ state: leaf13 }) });
      m.on(hub, { event: go14, to: [leaf14], handler: () => ({ state: leaf14 }) });
      m.on(hub, { event: go15, to: [leaf15], handler: () => ({ state: leaf15 }) });
      m.on(hub, { event: go16, to: [leaf16], handler: () => ({ state: leaf16 }) });
      m.on(hub, { event: go17, to: [leaf17], handler: () => ({ state: leaf17 }) });
      m.on(hub, { event: go18, to: [leaf18], handler: () => ({ state: leaf18 }) });
      m.on(hub, { event: go19, to: [leaf19], handler: () => ({ state: leaf19 }) });
    },
  });
}
