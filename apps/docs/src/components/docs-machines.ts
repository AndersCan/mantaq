/**
 * The machines the docs draw, by id. Shared by the build (inspect + fuzz in
 * `MachineViz.astro`) and the browser (a live driver per diagram), so both
 * run the same factory. Each call returns a fresh actor on a VirtualClock.
 */
import { VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { createCheckoutActor } from "../content/docs/checkout.ts";
import { createLoginActor } from "../content/docs/login.ts";
import { createSagaActor } from "../content/docs/saga.ts";

export interface DocsMachine {
  /** Machine module, relative to `src/content/docs/`. */
  file: string;
  create(): { actor: AnyActor<unknown>; clock: VirtualClock };
}

export const docsMachines = {
  checkout: { file: "checkout.ts", create: () => createCheckoutActor() },
  saga: {
    file: "saga.ts",
    create: () => {
      const clock = VirtualClock();
      return { actor: createSagaActor(clock), clock };
    },
  },
  login: { file: "login.ts", create: () => createLoginActor() },
} satisfies Record<string, DocsMachine>;

export type DocsMachineId = keyof typeof docsMachines;

export function isDocsMachineId(id: string): id is DocsMachineId {
  return Object.hasOwn(docsMachines, id);
}
