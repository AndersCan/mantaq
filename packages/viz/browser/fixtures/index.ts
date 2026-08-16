/**
 * Fixture registry — the single source of truth for the browser harness.
 *
 * Every fixture declares:
 * - a fresh `create()` (actor + VirtualClock),
 * - a deterministic `preScript` (sends run BEFORE mount — the graph is then a
 *   pure function of the script, plan §8),
 * - the expected graph shape (`declares`) — asserted by the drift guard
 *   (tests/fingerprints.test.ts) and by the Playwright structural gate,
 * - the event refs the `window.__viz` bridge can `send` from the page.
 */

import type { AnyActor, AnyEventRef, InternalEvent, VirtualClock } from "@mantaq/core";
import {
  createCheckoutActor,
  submitBasicInfo,
  submitPayment,
  submitShipping,
} from "./real/checkout.ts";
import {
  createAllFinalActor,
  createDoneActor,
  createLongLabelsActor,
  createRichContextActor,
  finish,
} from "./synthetic/small.ts";
import { createChainActor, next as chainNext } from "./synthetic/chain-50.ts";
import { createDenseActor, next as denseNext } from "./synthetic/dense-60.ts";
import { createTrafficLightActor, tick } from "./synthetic/traffic-light.ts";
import {
  createSelfLoopActor,
  createSingleActor,
  createThrowingContextActor,
  loop,
} from "./synthetic/edge-cases.ts";

export interface FixtureHost {
  actor: AnyActor;
  clock: VirtualClock;
}

export type FixtureTheme = "light" | "dark";

export interface FixtureDef {
  id: string;
  label: string;
  /** Human note: upstream source file + factory, or "synthetic". */
  source: string;
  version: number;
  create: () => FixtureHost;
  /** Deterministic sends before mount. Default: none. */
  preScript?: (host: FixtureHost) => void;
  /** Event refs exposed to `window.__viz.send(name, payload?)`. */
  events?: Record<string, AnyEventRef | InternalEvent>;
  declares: { nodeIds: string[]; nodeCount: number; edgeCount: number };
  /** Screenshot themes (plan §9: light default, dark for anchors). */
  themes: FixtureTheme[];
  /** Fixture mounts into an error state (throwing context). */
  errorAtMount?: boolean;
  /** Expected pending virtual timers once ready (settled fixtures: 0). */
  pendingTimers?: number;
}

const chainIds = Array.from({ length: 50 }, (_, i) => `step${String(i).padStart(2, "0")}`);
const denseIds = Array.from({ length: 60 }, (_, i) => `node${String(i).padStart(3, "0")}`);

const fixtures: Record<string, FixtureDef> = {
  checkout: {
    id: "checkout",
    label: "checkout (real)",
    source: "packages/examples/checkout.actor.test.ts — createCheckoutActor",
    version: 1,
    create: () =>
      // Pending charge promise: `submitting` is observable until advance()
      // fires submittingDone — deterministic for the interaction test.
      createCheckoutActor(undefined, () => new Promise(() => {})),
    preScript: ({ actor }) => {
      // basicInfo → shippingAddress → payment (mid-flight, no timers yet).
      actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
      actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    },
    events: { submitBasicInfo, submitPayment, submitShipping },
    declares: {
      nodeIds: [
        "__initial__",
        "basicInfo",
        "error",
        "payment",
        "shippingAddress",
        "submitting",
        "success",
      ],
      nodeCount: 7,
      edgeCount: 14,
    },
    themes: ["light", "dark"],
  },
  "traffic-light": {
    id: "traffic-light",
    label: "traffic-light (cyclic)",
    source: "synthetic — red → green → yellow → red",
    version: 1,
    create: () => createTrafficLightActor(),
    preScript: ({ actor }) => {
      // 7 full cycles → back in red, proving the cyclic acyclicer path.
      for (let i = 0; i < 21; i += 1) actor.send(tick.create());
    },
    events: { tick },
    declares: {
      nodeIds: ["__initial__", "green", "red", "yellow"],
      nodeCount: 4,
      edgeCount: 4,
    },
    themes: ["light", "dark"],
  },
  single: {
    id: "single",
    label: "single (no transitions)",
    source: "synthetic — one state, zero transitions",
    version: 1,
    create: () => createSingleActor(),
    declares: {
      nodeIds: ["__initial__", "idle"],
      nodeCount: 2,
      edgeCount: 1,
    },
    themes: ["light"],
  },
  "self-loop": {
    id: "self-loop",
    label: "self-loop",
    source: "synthetic — genuine `{state: same}` self-loop",
    version: 1,
    create: () => createSelfLoopActor(),
    events: { loop },
    declares: {
      nodeIds: ["__initial__", "wait"],
      nodeCount: 2,
      edgeCount: 2,
    },
    themes: ["light"],
  },
  __error: {
    id: "__error",
    label: "__error (throwing context)",
    source: "synthetic — context getter throws at build",
    version: 1,
    create: () => createThrowingContextActor(),
    errorAtMount: true,
    declares: { nodeIds: [], nodeCount: 0, edgeCount: 0 },
    themes: ["light"],
  },
  "chain-50": {
    id: "chain-50",
    label: "chain-50 (deep chain)",
    source: "synthetic — 50 linear states",
    version: 1,
    create: () => createChainActor(),
    preScript: ({ actor }) => {
      for (let i = 0; i < 3; i += 1) actor.send(chainNext.create());
    },
    events: { next: chainNext },
    declares: {
      nodeIds: ["__initial__", ...chainIds],
      nodeCount: 51,
      edgeCount: 50,
    },
    themes: ["light"],
  },
  "dense-60": {
    id: "dense-60",
    label: "dense-60 (mesh)",
    source: "synthetic — 60-node cyclic mesh, 2 edges per node",
    version: 1,
    create: () => createDenseActor(),
    preScript: ({ actor }) => {
      actor.send(denseNext.create());
    },
    events: { next: denseNext },
    declares: {
      nodeIds: ["__initial__", ...denseIds],
      nodeCount: 61,
      edgeCount: 121,
    },
    themes: ["light"],
  },
  done: {
    id: "done",
    label: "done (completes on first send)",
    source: "synthetic — working → done (final)",
    version: 1,
    create: () => createDoneActor(),
    preScript: ({ actor }) => {
      actor.send(finish.create());
    },
    events: { finish },
    declares: {
      nodeIds: ["__initial__", "done", "working"],
      nodeCount: 3,
      edgeCount: 2,
    },
    themes: ["light"],
  },
  "all-final": {
    id: "all-final",
    label: "final-heavy (one non-final initial)",
    source: "synthetic — initial + all other states final",
    version: 1,
    create: () => createAllFinalActor(),
    declares: {
      nodeIds: ["__initial__", "blue", "green", "red"],
      nodeCount: 4,
      edgeCount: 1,
    },
    themes: ["light"],
  },
  "long-labels": {
    id: "long-labels",
    label: "long-labels (overflow)",
    source: "synthetic — 120+ char ids + unicode",
    version: 1,
    create: () => createLongLabelsActor(),
    declares: {
      nodeIds: [
        "__initial__",
        "λ-names-and-unicode-信号-and-long-tail",
        "short",
        "state-with-an-exceptionally-long-name-that-would-overflow-any-reasonable-node-width",
      ],
      nodeCount: 4,
      edgeCount: 4,
    },
    themes: ["light"],
  },
  "rich-context": {
    id: "rich-context",
    label: "rich-context (all JS types)",
    source: "synthetic — fn/symbol/bigint/Date/Map/Set/circular",
    version: 1,
    create: () => createRichContextActor(),
    declares: {
      nodeIds: ["__initial__", "ready", "work"],
      nodeCount: 3,
      edgeCount: 3,
    },
    themes: ["light"],
  },
};

export const fixtureList: FixtureDef[] = Object.values(fixtures);

/** Resolve a fixture by id (used by the router). */
export function getFixture(id: string): FixtureDef | undefined {
  return fixtures[id];
}
