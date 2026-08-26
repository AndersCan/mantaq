/**
 * Actor reimplementation of xstate animation & complex UI state.
 *
 * Mapping from xstate v5 → actor system:
 *   - Sequential animation states → state() refs with timed effects
 *   - after-duration delays → effect with clock.setTimeout
 *   - Parallel states (xstate) → regions as child Actors
 *   - `entry`/`exit` actions → handled in transition handlers
 *
 * Structure:
 *   drawerRoot → drawerOpening → drawerRoot (animated open)
 *   drawerRoot → drawerClosing → drawerRoot (animated close)
 *   Regions: brightness, color, dashboard, sidebar
 */

import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, withTimeout, states, events } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

// ── Types ────────────────────────────────────────────────────────────
type Brightness = "dim" | "normal" | "bright";

// ── State refs (immutable labels, shared) ────────────────────────────
const brightness = states("dim", "normal", "bright");
const color = states("blue", "red", "green");
const dashboard = states("closed", "open");
const sidebar = states("closed", "open");
const drawer = states("drawerRoot", "drawerOpening", "drawerClosing");

// ── Event refs (immutable, shared) ───────────────────────────────────
const regionEvents = events("CYCLE_COLOR", "TOGGLE_DASHBOARD", "TOGGLE_SIDEBAR");
const setBrightnessRegionEvent = event("SET_BRIGHTNESS")<{ level: Brightness }>();

const mainEvents = events(
  "OPEN_DRAWER",
  "CLOSE_DRAWER",
  "TOGGLE_DASHBOARD",
  "TOGGLE_SIDEBAR",
  "CYCLE_COLOR",
);
const setBrightnessEvent = event("SET_BRIGHTNESS")<{ level: Brightness }>();

const doneEvents = events("DRAWER_OPEN_DONE", "DRAWER_CLOSE_DONE");

// ── Actor factory (fresh region instances per call) ─────────────────
function createAnimationActor(clock?: VirtualClock) {
  const c = clock ?? VirtualClock();

  const brightnessRegion = Actor({
    inputs: [setBrightnessRegionEvent],
    outputs: [],
    internal: [],
    states: [brightness.dim, brightness.normal, brightness.bright],
    initial: brightness.normal,
    context: {},
    setup: (m) => {
      m.on(brightness.dim, {
        eventRef: setBrightnessRegionEvent,
        handler: () => ({ state: brightness.normal }),
      });
      m.on(brightness.normal, {
        eventRef: setBrightnessRegionEvent,
        handler: () => ({ state: brightness.bright }),
      });
      m.on(brightness.bright, {
        eventRef: setBrightnessRegionEvent,
        handler: () => ({ state: brightness.normal }),
      });
    },
  });

  const colorRegion = Actor({
    inputs: [regionEvents.CYCLE_COLOR],
    outputs: [],
    internal: [],
    states: [color.blue, color.red, color.green],
    initial: color.blue,
    context: {},
    setup: (m) => {
      m.on(color.blue, {
        eventRef: regionEvents.CYCLE_COLOR,
        handler: () => ({ state: color.red }),
      });
      m.on(color.red, {
        eventRef: regionEvents.CYCLE_COLOR,
        handler: () => ({ state: color.green }),
      });
      m.on(color.green, {
        eventRef: regionEvents.CYCLE_COLOR,
        handler: () => ({ state: color.blue }),
      });
    },
  });

  const dashboardRegion = Actor({
    inputs: [regionEvents.TOGGLE_DASHBOARD],
    outputs: [],
    internal: [],
    states: [dashboard.closed, dashboard.open],
    initial: dashboard.closed,
    context: {},
    setup: (m) => {
      m.on(dashboard.closed, {
        eventRef: regionEvents.TOGGLE_DASHBOARD,
        handler: () => ({ state: dashboard.open }),
      });
      m.on(dashboard.open, {
        eventRef: regionEvents.TOGGLE_DASHBOARD,
        handler: () => ({ state: dashboard.closed }),
      });
    },
  });

  const sidebarRegion = Actor({
    inputs: [regionEvents.TOGGLE_SIDEBAR],
    outputs: [],
    internal: [],
    states: [sidebar.closed, sidebar.open],
    initial: sidebar.closed,
    context: {},
    setup: (m) => {
      m.on(sidebar.closed, {
        eventRef: regionEvents.TOGGLE_SIDEBAR,
        handler: () => ({ state: sidebar.open }),
      });
      m.on(sidebar.open, {
        eventRef: regionEvents.TOGGLE_SIDEBAR,
        handler: () => ({ state: sidebar.closed }),
      });
    },
  });

  const actor = Actor({
    inputs: [
      mainEvents.OPEN_DRAWER,
      mainEvents.CLOSE_DRAWER,
      mainEvents.TOGGLE_DASHBOARD,
      mainEvents.TOGGLE_SIDEBAR,
      setBrightnessEvent,
      mainEvents.CYCLE_COLOR,
    ],
    outputs: [],
    internal: [doneEvents.DRAWER_OPEN_DONE, doneEvents.DRAWER_CLOSE_DONE],
    states: [drawer.drawerRoot, drawer.drawerOpening, drawer.drawerClosing],
    initial: drawer.drawerRoot,
    clock: c,
    context: {},
    regions: {
      brightness: brightnessRegion,
      color: colorRegion,
      dashboard: dashboardRegion,
      sidebar: sidebarRegion,
    },
    setup: (m) => {
      m.effect(drawer.drawerOpening, {
        name: "timeDrawerOpen",
        fn: (input) =>
          withTimeout(300, { input: input, event: () => ({ type: "DRAWER_OPEN_DONE" }) }),
      });
      m.effect(drawer.drawerClosing, {
        name: "timeDrawerClose",
        fn: (input) =>
          withTimeout(300, { input: input, event: () => ({ type: "DRAWER_CLOSE_DONE" }) }),
      });
      m.on(drawer.drawerRoot, {
        eventRef: mainEvents.OPEN_DRAWER,
        handler: () => ({ state: drawer.drawerOpening }),
      });
      m.on(drawer.drawerRoot, {
        eventRef: mainEvents.CLOSE_DRAWER,
        handler: () => ({ state: drawer.drawerClosing }),
      });
      m.on(drawer.drawerOpening, {
        eventRef: doneEvents.DRAWER_OPEN_DONE,
        handler: () => ({ state: drawer.drawerRoot }),
      });
      m.on(drawer.drawerClosing, {
        eventRef: doneEvents.DRAWER_CLOSE_DONE,
        handler: () => ({
          state: drawer.drawerRoot,
        }),
      });
      m.onAny({
        eventRef: mainEvents.TOGGLE_DASHBOARD,
        handler: () => {
          actor.regions.dashboard.send(regionEvents.TOGGLE_DASHBOARD.create());
          return {};
        },
      });
      m.onAny({
        eventRef: mainEvents.TOGGLE_SIDEBAR,
        handler: () => {
          actor.regions.sidebar.send(regionEvents.TOGGLE_SIDEBAR.create());
          return {};
        },
      });
      m.onAny({
        eventRef: setBrightnessEvent,
        handler: (event) => {
          actor.regions.brightness.send(
            setBrightnessRegionEvent.create({ level: event.payload.level }),
          );
          return {};
        },
      });
      m.onAny({
        eventRef: mainEvents.CYCLE_COLOR,
        handler: () => {
          actor.regions.color.send(regionEvents.CYCLE_COLOR.create());
          return {};
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ──────────────────────────────────────────────────────────
describe("animation & UI state actor", () => {
  it("sets drawerRoot and default region states initially", () => {
    const { actor } = createAnimationActor();
    expect(matches(actor, "drawerRoot")).toBe(true);
    expect(matches(actor, "drawerRoot.brightness.normal")).toBe(true);
    expect(matches(actor, "drawerRoot.color.blue")).toBe(true);
    expect(matches(actor, "drawerRoot.dashboard.closed")).toBe(true);
    expect(matches(actor, "drawerRoot.sidebar.closed")).toBe(true);
  });

  it("returns to drawerRoot after the open animation completes", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.OPEN_DRAWER.create());
    expect(matches(actor, "drawerOpening")).toBe(true);

    clock.advance(150);
    expect(matches(actor, "drawerOpening")).toBe(true);

    clock.advance(150);
    expect(matches(actor, "drawerRoot")).toBe(true);
  });

  it("returns to drawerRoot after the close animation completes", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.CLOSE_DRAWER.create());
    expect(matches(actor, "drawerClosing")).toBe(true);

    clock.advance(300);
    expect(matches(actor, "drawerRoot")).toBe(true);
  });

  it("ignores OPEN_DRAWER while an animation is already in progress", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.OPEN_DRAWER.create());
    expect(matches(actor, "drawerOpening")).toBe(true);

    actor.send(mainEvents.OPEN_DRAWER.create());
    expect(matches(actor, "drawerOpening")).toBe(true);

    clock.advance(300);
    expect(matches(actor, "drawerRoot")).toBe(true);
  });

  it("updates the dashboard region when TOGGLE_DASHBOARD fires", () => {
    const { actor } = createAnimationActor();

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    expect(matches(actor, "drawerRoot.dashboard.open")).toBe(true);
    expect(matches(actor, "drawerRoot")).toBe(true);

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    expect(matches(actor, "drawerRoot.dashboard.closed")).toBe(true);
  });

  it("updates the sidebar region independently of the dashboard", () => {
    const { actor } = createAnimationActor();

    actor.send(mainEvents.TOGGLE_SIDEBAR.create());
    expect(matches(actor, "drawerRoot.sidebar.open")).toBe(true);

    actor.send(mainEvents.TOGGLE_SIDEBAR.create());
    expect(matches(actor, "drawerRoot.sidebar.closed")).toBe(true);
  });

  it("handles SET_BRIGHTNESS cycling through the levels", () => {
    const { actor } = createAnimationActor();

    actor.send(setBrightnessEvent.create({ level: "dim" }));
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);

    actor.send(setBrightnessEvent.create({ level: "bright" }));
    expect(matches(actor, "drawerRoot.brightness.normal")).toBe(true);

    actor.send(setBrightnessEvent.create({ level: "normal" }));
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);
  });

  it("handles CYCLE_COLOR cycling blue, red, green", () => {
    const { actor } = createAnimationActor();

    expect(matches(actor, "drawerRoot.color.blue")).toBe(true);

    actor.send(mainEvents.CYCLE_COLOR.create());
    expect(matches(actor, "drawerRoot.color.red")).toBe(true);

    actor.send(mainEvents.CYCLE_COLOR.create());
    expect(matches(actor, "drawerRoot.color.green")).toBe(true);

    actor.send(mainEvents.CYCLE_COLOR.create());
    expect(matches(actor, "drawerRoot.color.blue")).toBe(true);
  });

  it("keeps all region dimensions independent", () => {
    const { actor } = createAnimationActor();

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    actor.send(mainEvents.TOGGLE_SIDEBAR.create());
    actor.send(setBrightnessEvent.create({ level: "dim" }));
    actor.send(mainEvents.CYCLE_COLOR.create());

    expect(matches(actor, "drawerRoot.dashboard.open")).toBe(true);
    expect(matches(actor, "drawerRoot.sidebar.open")).toBe(true);
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);
    expect(matches(actor, "drawerRoot.color.red")).toBe(true);

    actor.send(setBrightnessEvent.create({ level: "normal" }));
    expect(matches(actor, "drawerRoot.brightness.normal")).toBe(true);
    expect(matches(actor, "drawerRoot.sidebar.open")).toBe(true);
    expect(matches(actor, "drawerRoot.color.red")).toBe(true);
  });

  it("keeps region states unchanged during drawer animation", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    actor.send(setBrightnessEvent.create({ level: "dim" }));

    actor.send(mainEvents.OPEN_DRAWER.create());
    clock.advance(300);
    expect(matches(actor, "drawerRoot")).toBe(true);
    expect(matches(actor, "drawerRoot.dashboard.open")).toBe(true);
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);
  });

  it("handles opening the drawer then toggling every setting", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.OPEN_DRAWER.create());
    clock.advance(300);

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    actor.send(mainEvents.TOGGLE_SIDEBAR.create());
    actor.send(setBrightnessEvent.create({ level: "dim" }));
    actor.send(mainEvents.CYCLE_COLOR.create());

    expect(matches(actor, "drawerRoot.dashboard.open")).toBe(true);
    expect(matches(actor, "drawerRoot.sidebar.open")).toBe(true);
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);
    expect(matches(actor, "drawerRoot.color.red")).toBe(true);

    actor.send(mainEvents.CLOSE_DRAWER.create());
    clock.advance(300);
    expect(matches(actor, "drawerRoot")).toBe(true);
  });
});
