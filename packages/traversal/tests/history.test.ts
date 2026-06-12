import { expect, test, describe } from "vite-plus/test";
import { History } from "../src/history.ts";

describe("History", () => {
  test("append and retrieve entries", () => {
    const h = new History();
    h.append({ type: "send", data: { event: "GO", timestamp: 1 } });
    h.append({ type: "state_visit", data: { stateName: "active", timestamp: 2 } });

    expect(h.entries().length).toBe(2);
    expect(h.entries()[0].type).toBe("send");
    expect(h.entries()[1].type).toBe("state_visit");
  });

  test("stateVisits filters correctly", () => {
    const h = new History();
    h.append({ type: "send", data: { event: "GO", timestamp: 1 } });
    h.append({ type: "state_visit", data: { stateName: "active", timestamp: 2 } });
    h.append({ type: "state_visit", data: { stateName: "done", timestamp: 3 } });

    const visits = h.stateVisits();
    expect(visits.length).toBe(2);
    expect(visits[0].stateName).toBe("active");
    expect(visits[1].stateName).toBe("done");
  });

  test("transitions filters correctly", () => {
    const h = new History();
    h.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active", timestamp: 1 },
    });
    h.append({ type: "send", data: { event: "GO", timestamp: 2 } });

    const t = h.transitions();
    expect(t.length).toBe(1);
    expect(t[0].from).toBe("idle");
    expect(t[0].to).toBe("active");
  });

  test("effects filters correctly", () => {
    const h = new History();
    h.append({ type: "effect", data: { stateName: "active", timestamp: 1 } });
    h.append({ type: "send", data: { event: "GO", timestamp: 2 } });

    const e = h.effects();
    expect(e.length).toBe(1);
    expect(e[0].stateName).toBe("active");
  });

  test("sends filters correctly", () => {
    const h = new History();
    h.append({ type: "send", data: { event: "GO", timestamp: 1 } });
    h.append({ type: "send", data: { event: "STOP", timestamp: 2 } });
    h.append({ type: "state_visit", data: { stateName: "active", timestamp: 3 } });

    const s = h.sends();
    expect(s.length).toBe(2);
    expect(s[0].event).toBe("GO");
    expect(s[1].event).toBe("STOP");
  });

  test("visitedStates returns Set", () => {
    const h = new History();
    h.append({ type: "state_visit", data: { stateName: "idle", timestamp: 1 } });
    h.append({ type: "state_visit", data: { stateName: "active", timestamp: 2 } });
    h.append({ type: "state_visit", data: { stateName: "idle", timestamp: 3 } });

    const visited = h.visitedStates();
    expect(visited).toBeInstanceOf(Set);
    expect(visited.size).toBe(2);
    expect(visited.has("idle")).toBe(true);
    expect(visited.has("active")).toBe(true);
  });

  test("firedTransitions returns Set of state:event strings", () => {
    const h = new History();
    h.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active", timestamp: 1 },
    });
    h.append({
      type: "transition",
      data: { from: "active", event: "STOP", to: "idle", timestamp: 2 },
    });
    h.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active", timestamp: 3 },
    });

    const fired = h.firedTransitions();
    expect(fired).toBeInstanceOf(Set);
    expect(fired.size).toBe(2);
    expect(fired.has("idle:GO")).toBe(true);
    expect(fired.has("active:STOP")).toBe(true);
  });

  test("reset clears everything", () => {
    const h = new History();
    h.append({ type: "send", data: { event: "GO", timestamp: 1 } });
    h.append({ type: "state_visit", data: { stateName: "active", timestamp: 2 } });
    h.append({
      type: "transition",
      data: { from: "idle", event: "GO", to: "active", timestamp: 3 },
    });
    h.append({ type: "effect", data: { stateName: "active", timestamp: 4 } });

    h.reset();
    expect(h.entries().length).toBe(0);
    expect(h.stateVisits().length).toBe(0);
    expect(h.transitions().length).toBe(0);
    expect(h.effects().length).toBe(0);
    expect(h.sends().length).toBe(0);
  });
});
