// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  $timers,
  $timerSpeed,
  setActor,
  pauseTimer,
  resumeTimer,
  cancelTimer,
  setTimerSpeed,
} from "../src/graph-store.ts";
import { Actor, VirtualClock, state, event } from "@mantaq/core";

function createActorWithTimer() {
  const idle = state("idle")();
  const active = state("active")();
  const done = state("done")();
  const go = event("GO")();
  const timeout = event("TIMEOUT")();
  const clock = new VirtualClock();

  const actor = new Actor({
    inputs: [go],
    outputs: [],
    internal: [timeout],
    states: [idle, active, done],
    initial: idle,
    clock,
    context: {} as {},
    effects: {
      active: [
        (input: any) => {
          input.clock.setTimeout(5000, () => {
            if (input.signal.aborted) return;
            input.emit({ id: "TIMEOUT" });
          });
        },
      ],
    },
    transitions: {
      idle: { GO: () => ({ state: active }) },
      active: { TIMEOUT: () => ({ state: done }) },
    },
  });

  return { actor, clock, go, idle, active, done };
}

function createActorWithoutTimer() {
  const idle = state("idle")();
  const active = state("active")();
  const go = event("GO")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [],
    states: [idle, active],
    initial: idle,
    context: {} as {},
    effects: {},
    transitions: {
      idle: { GO: () => ({ state: active }) },
    },
  });
}

describe("timer store", () => {
  beforeEach(() => {
    $timers.set([]);
    $timerSpeed.set(1);
  });

  it("starts with empty timers", () => {
    expect($timers.get()).toEqual([]);
  });

  it("starts with timer speed 1", () => {
    expect($timerSpeed.get()).toBe(1);
  });

  it("setActor extracts timers from VirtualClock", async () => {
    const { actor, go } = createActorWithTimer();
    actor.send(go);
    await setActor(actor as any);

    const timers = $timers.get();
    expect(timers.length).toBeGreaterThanOrEqual(1);
    if (timers.length > 0) {
      expect(timers[0].duration).toBe(5000);
      expect(timers[0].status).toBe("running");
    }
  });

  it("setActor with no timers returns empty", async () => {
    const actor = createActorWithoutTimer();
    await setActor(actor as any);

    expect($timers.get()).toEqual([]);
  });

  it("pauseTimer changes status to paused", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "running" },
    ]);
    pauseTimer("1");
    expect($timers.get()[0].status).toBe("paused");
  });

  it("resumeTimer changes status to running", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "paused" },
    ]);
    resumeTimer("1");
    expect($timers.get()[0].status).toBe("running");
  });

  it("cancelTimer changes status to cancelled", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "running" },
    ]);
    cancelTimer("1");
    expect($timers.get()[0].status).toBe("cancelled");
  });

  it("setTimerSpeed clamps to min", () => {
    setTimerSpeed(0.01);
    expect($timerSpeed.get()).toBe(0.1);
  });

  it("setTimerSpeed clamps to max", () => {
    setTimerSpeed(100);
    expect($timerSpeed.get()).toBe(10);
  });

  it("setTimerSpeed accepts valid values", () => {
    setTimerSpeed(2);
    expect($timerSpeed.get()).toBe(2);
  });

  it("pauseTimer does not affect other timers", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "running" },
      { id: "2", nodeId: "b", label: "3000ms", duration: 3000, elapsed: 0, status: "running" },
    ]);
    pauseTimer("1");
    expect($timers.get()[0].status).toBe("paused");
    expect($timers.get()[1].status).toBe("running");
  });

  it("cancelTimer works from any status", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "paused" },
    ]);
    cancelTimer("1");
    expect($timers.get()[0].status).toBe("cancelled");
  });

  it("pauseTimer on already paused timer is no-op", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "paused" },
    ]);
    pauseTimer("1");
    expect($timers.get()[0].status).toBe("paused");
  });

  it("pauseTimer on cancelled timer is no-op", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "cancelled" },
    ]);
    pauseTimer("1");
    expect($timers.get()[0].status).toBe("cancelled");
  });

  it("resumeTimer on running timer is no-op", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "running" },
    ]);
    resumeTimer("1");
    expect($timers.get()[0].status).toBe("running");
  });

  it("resumeTimer on cancelled timer is no-op", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "cancelled" },
    ]);
    resumeTimer("1");
    expect($timers.get()[0].status).toBe("cancelled");
  });

  it("pauseTimer with non-existent id is no-op", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "running" },
    ]);
    pauseTimer("nonexistent");
    expect($timers.get()[0].status).toBe("running");
  });

  it("resumeTimer with non-existent id is no-op", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "paused" },
    ]);
    resumeTimer("nonexistent");
    expect($timers.get()[0].status).toBe("paused");
  });

  it("cancelTimer with non-existent id is no-op", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "running" },
    ]);
    cancelTimer("nonexistent");
    expect($timers.get()[0].status).toBe("running");
  });

  it("cancelTimer on already cancelled timer stays cancelled", () => {
    $timers.set([
      { id: "1", nodeId: "a", label: "5000ms", duration: 5000, elapsed: 0, status: "cancelled" },
    ]);
    cancelTimer("1");
    expect($timers.get()[0].status).toBe("cancelled");
  });

  it("pauseTimer preserves other timer properties", () => {
    $timers.set([
      { id: "1", nodeId: "node-a", label: "3000ms", duration: 3000, elapsed: 0, status: "running" },
    ]);
    pauseTimer("1");
    const t = $timers.get()[0];
    expect(t.id).toBe("1");
    expect(t.nodeId).toBe("node-a");
    expect(t.label).toBe("3000ms");
    expect(t.duration).toBe(3000);
  });

  it("setTimerSpeed at exact min boundary", () => {
    setTimerSpeed(0.1);
    expect($timerSpeed.get()).toBe(0.1);
  });

  it("setTimerSpeed at exact max boundary", () => {
    setTimerSpeed(10);
    expect($timerSpeed.get()).toBe(10);
  });

  it("setTimerSpeed handles zero", () => {
    setTimerSpeed(0);
    expect($timerSpeed.get()).toBe(0.1);
  });

  it("setTimerSpeed handles negative", () => {
    setTimerSpeed(-5);
    expect($timerSpeed.get()).toBe(0.1);
  });

  it("setTimerSpeed handles decimal values", () => {
    setTimerSpeed(2.5);
    expect($timerSpeed.get()).toBe(2.5);
  });

  it("setActor with non-VirtualClock returns empty timers", async () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {},
    });
    await setActor(actor as any);
    expect($timers.get()).toEqual([]);
  });
});
