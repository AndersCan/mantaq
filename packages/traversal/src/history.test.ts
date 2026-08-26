import { createHistory } from "./history.ts";
import { describe, expect, test } from "vite-plus/test";

describe("createHistory", () => {
  test("returns appended entries in insertion order", () => {
    const history = createHistory();
    history.append({ type: "send", data: { event: "GO" } });
    history.append({ type: "state_visit", data: { stateName: "active" } });

    expect(history.entries()).toEqual([
      { type: "send", data: { event: "GO" } },
      { type: "state_visit", data: { stateName: "active" } },
    ]);
  });

  test("returns only state visits from stateVisits", () => {
    const history = createHistory();
    history.append({ type: "send", data: { event: "GO" } });
    history.append({ type: "state_visit", data: { stateName: "active" } });
    history.append({ type: "state_visit", data: { stateName: "done" } });

    expect(history.stateVisits()).toEqual([{ stateName: "active" }, { stateName: "done" }]);
  });

  test("returns only transition records from transitions", () => {
    const history = createHistory();
    history.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active" },
    });
    history.append({ type: "send", data: { event: "GO" } });

    expect(history.transitions()).toEqual([{ from: "idle", event: "GO", to: "active" }]);
  });

  test("returns only effect records from effects", () => {
    const history = createHistory();
    history.append({
      type: "effect",
      data: { stateName: "active", effectName: "fetchProfile" },
    });
    history.append({ type: "send", data: { event: "GO" } });

    expect(history.effects()).toEqual([{ stateName: "active", effectName: "fetchProfile" }]);
  });

  test("returns only send records from sends", () => {
    const history = createHistory();
    history.append({ type: "send", data: { event: "GO" } });
    history.append({ type: "send", data: { event: "STOP" } });
    history.append({ type: "state_visit", data: { stateName: "active" } });

    expect(history.sends()).toEqual([{ event: "GO" }, { event: "STOP" }]);
  });

  test("returns the set of distinct visited states from visitedStates", () => {
    const history = createHistory();
    history.append({ type: "state_visit", data: { stateName: "idle" } });
    history.append({ type: "state_visit", data: { stateName: "active" } });
    history.append({ type: "state_visit", data: { stateName: "idle" } });

    expect(history.visitedStates()).toEqual(new Set(["idle", "active"]));
  });

  test("returns the set of fired from:event strings from firedTransitions", () => {
    const history = createHistory();
    history.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active" },
    });
    history.append({
      type: "transition",
      data: { from: "active", event: "STOP", to: "idle" },
    });
    history.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active" },
    });

    expect(history.firedTransitions()).toEqual(new Set(["idle:GO", "active:STOP"]));
  });

  test("deletes every record class after reset", () => {
    const history = createHistory();
    history.append({ type: "send", data: { event: "GO" } });
    history.append({ type: "state_visit", data: { stateName: "active" } });
    history.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active" },
    });
    history.append({
      type: "effect",
      data: { stateName: "active", effectName: "fetchProfile" },
    });

    history.reset();
    expect(history.entries()).toEqual([]);
    expect(history.stateVisits()).toEqual([]);
    expect(history.transitions()).toEqual([]);
    expect(history.effects()).toEqual([]);
    expect(history.sends()).toEqual([]);
  });
});
