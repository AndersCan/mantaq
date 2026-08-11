/**
 * Actor reimplementation of xstate animation & complex UI state.
 *
 * Mapping from xstate v5 → actor system:
 *   - Sequential animation states → state() refs with timed effects
 *   - `after: { duration }` → effect with clock.setTimeout
 *   - Parallel states (xstate) → regions as child Actors
 *   - `entry`/`exit` actions → handled in transition handlers
 *
 * Structure:
 *   drawerRoot → drawerOpening → drawerRoot (animated open)
 *   drawerRoot → drawerClosing → drawerRoot (animated close)
 *   Regions: brightness, color, dashboard, sidebar
 */

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, withTimeout, states, events } from "@mantaq/sugar";

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
  const c = clock ?? new VirtualClock();

  const brightnessRegion = new Actor({
    inputs: [setBrightnessRegionEvent],
    outputs: [],
    internal: [],
    states: [brightness.dim, brightness.normal, brightness.bright],
    initial: brightness.normal,
    context: {} as {},
    setup: (m) => {
      m.on(brightness.dim, setBrightnessRegionEvent, () => ({ state: brightness.normal }));
      m.on(brightness.normal, setBrightnessRegionEvent, () => ({ state: brightness.bright }));
      m.on(brightness.bright, setBrightnessRegionEvent, () => ({ state: brightness.normal }));
    },
  });

  const colorRegion = new Actor({
    inputs: [regionEvents.CYCLE_COLOR],
    outputs: [],
    internal: [],
    states: [color.blue, color.red, color.green],
    initial: color.blue,
    context: {} as {},
    setup: (m) => {
      m.on(color.blue, regionEvents.CYCLE_COLOR, () => ({ state: color.red }));
      m.on(color.red, regionEvents.CYCLE_COLOR, () => ({ state: color.green }));
      m.on(color.green, regionEvents.CYCLE_COLOR, () => ({ state: color.blue }));
    },
  });

  const dashboardRegion = new Actor({
    inputs: [regionEvents.TOGGLE_DASHBOARD],
    outputs: [],
    internal: [],
    states: [dashboard.closed, dashboard.open],
    initial: dashboard.closed,
    context: {} as {},
    setup: (m) => {
      m.on(dashboard.closed, regionEvents.TOGGLE_DASHBOARD, () => ({ state: dashboard.open }));
      m.on(dashboard.open, regionEvents.TOGGLE_DASHBOARD, () => ({ state: dashboard.closed }));
    },
  });

  const sidebarRegion = new Actor({
    inputs: [regionEvents.TOGGLE_SIDEBAR],
    outputs: [],
    internal: [],
    states: [sidebar.closed, sidebar.open],
    initial: sidebar.closed,
    context: {} as {},
    setup: (m) => {
      m.on(sidebar.closed, regionEvents.TOGGLE_SIDEBAR, () => ({ state: sidebar.open }));
      m.on(sidebar.open, regionEvents.TOGGLE_SIDEBAR, () => ({ state: sidebar.closed }));
    },
  });

  const actor = new Actor({
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
    context: {} as {},
    regions: {
      brightness: brightnessRegion,
      color: colorRegion,
      dashboard: dashboardRegion,
      sidebar: sidebarRegion,
    },
    setup: (m) => {
      m.effect(drawer.drawerOpening, (input) =>
        withTimeout(300, input, () => ({ type: "DRAWER_OPEN_DONE" })),
      );
      m.effect(drawer.drawerClosing, (input) =>
        withTimeout(300, input, () => ({ type: "DRAWER_CLOSE_DONE" })),
      );
      m.on(drawer.drawerRoot, mainEvents.OPEN_DRAWER, () => ({ state: drawer.drawerOpening }));
      m.on(drawer.drawerRoot, mainEvents.CLOSE_DRAWER, () => ({ state: drawer.drawerClosing }));
      m.on(drawer.drawerOpening, doneEvents.DRAWER_OPEN_DONE, () => ({ state: drawer.drawerRoot }));
      m.on(drawer.drawerClosing, doneEvents.DRAWER_CLOSE_DONE, () => ({
        state: drawer.drawerRoot,
      }));
      m.onAny(mainEvents.TOGGLE_DASHBOARD, () => {
        actor.regions.dashboard.send(regionEvents.TOGGLE_DASHBOARD.create());
        return {};
      });
      m.onAny(mainEvents.TOGGLE_SIDEBAR, () => {
        actor.regions.sidebar.send(regionEvents.TOGGLE_SIDEBAR.create());
        return {};
      });
      m.onAny(setBrightnessEvent, (event) => {
        actor.regions.brightness.send(
          setBrightnessRegionEvent.create({ level: event.payload.level }),
        );
        return {};
      });
      m.onAny(mainEvents.CYCLE_COLOR, () => {
        actor.regions.color.send(regionEvents.CYCLE_COLOR.create());
        return {};
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ──────────────────────────────────────────────────────────
describe("animation & UI state actor", () => {
  it("starts at root with default region states", () => {
    const { actor } = createAnimationActor();
    expect(matches(actor, "drawerRoot")).toBe(true);
    expect(matches(actor, "drawerRoot.brightness.normal")).toBe(true);
    expect(matches(actor, "drawerRoot.color.blue")).toBe(true);
    expect(matches(actor, "drawerRoot.dashboard.closed")).toBe(true);
    expect(matches(actor, "drawerRoot.sidebar.closed")).toBe(true);
  });

  it("drawer: root → opening → root (animated open)", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.OPEN_DRAWER.create());
    expect(matches(actor, "drawerOpening")).toBe(true);

    clock.advance(150);
    expect(matches(actor, "drawerOpening")).toBe(true);

    clock.advance(150);
    expect(matches(actor, "drawerRoot")).toBe(true);
  });

  it("drawer: root → closing → root (animated close)", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.CLOSE_DRAWER.create());
    expect(matches(actor, "drawerClosing")).toBe(true);

    clock.advance(300);
    expect(matches(actor, "drawerRoot")).toBe(true);
  });

  it("drawer: cannot start new animation while one is in progress", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.OPEN_DRAWER.create());
    expect(matches(actor, "drawerOpening")).toBe(true);

    actor.send(mainEvents.OPEN_DRAWER.create());
    expect(matches(actor, "drawerOpening")).toBe(true);

    clock.advance(300);
    expect(matches(actor, "drawerRoot")).toBe(true);
  });

  it("dashboard: toggle on and off", () => {
    const { actor } = createAnimationActor();

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    expect(matches(actor, "drawerRoot.dashboard.open")).toBe(true);
    expect(matches(actor, "drawerRoot")).toBe(true);

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    expect(matches(actor, "drawerRoot.dashboard.closed")).toBe(true);
  });

  it("sidebar: toggle independently of dashboard", () => {
    const { actor } = createAnimationActor();

    actor.send(mainEvents.TOGGLE_SIDEBAR.create());
    expect(matches(actor, "drawerRoot.sidebar.open")).toBe(true);

    actor.send(mainEvents.TOGGLE_SIDEBAR.create());
    expect(matches(actor, "drawerRoot.sidebar.closed")).toBe(true);
  });

  it("brightness: cycle normal → bright → normal → dim → normal", () => {
    const { actor } = createAnimationActor();

    actor.send(setBrightnessEvent.create({ level: "dim" }));
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);

    actor.send(setBrightnessEvent.create({ level: "bright" }));
    expect(matches(actor, "drawerRoot.brightness.normal")).toBe(true);

    actor.send(setBrightnessEvent.create({ level: "normal" }));
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);
  });

  it("color: cycle blue → red → green → blue", () => {
    const { actor } = createAnimationActor();

    expect(matches(actor, "drawerRoot.color.blue")).toBe(true);

    actor.send(mainEvents.CYCLE_COLOR.create());
    expect(matches(actor, "drawerRoot.color.red")).toBe(true);

    actor.send(mainEvents.CYCLE_COLOR.create());
    expect(matches(actor, "drawerRoot.color.green")).toBe(true);

    actor.send(mainEvents.CYCLE_COLOR.create());
    expect(matches(actor, "drawerRoot.color.blue")).toBe(true);
  });

  it("all region dimensions are independent", () => {
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

  it("drawer animation does not affect region states", () => {
    const { actor, clock } = createAnimationActor();

    actor.send(mainEvents.TOGGLE_DASHBOARD.create());
    actor.send(setBrightnessEvent.create({ level: "dim" }));

    actor.send(mainEvents.OPEN_DRAWER.create());
    clock.advance(300);
    expect(matches(actor, "drawerRoot")).toBe(true);
    expect(matches(actor, "drawerRoot.dashboard.open")).toBe(true);
    expect(matches(actor, "drawerRoot.brightness.bright")).toBe(true);
  });

  it("full flow: open drawer, toggle settings", () => {
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
