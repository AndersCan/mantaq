// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import "../src/components/timer-indicator.ts";
import type { TimerIndicator } from "../src/components/timer-indicator.ts";

function createTimerIndicator(
  props: Partial<{
    timerId: string;
    nodeId: string;
    label: string;
    duration: number;
    elapsed: number;
    status: "running" | "paused" | "cancelled";
  }> = {},
): TimerIndicator {
  const el = document.createElement("timer-indicator") as TimerIndicator;
  el.timerId = props.timerId ?? "t1";
  el.nodeId = props.nodeId ?? "node-a";
  el.label = props.label ?? "5000ms";
  el.duration = props.duration ?? 5000;
  el.elapsed = props.elapsed ?? 0;
  el.status = props.status ?? "running";
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TimerIndicator component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("timer-indicator");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("timer-indicator");
  });

  it("renders timer badge", () => {
    const el = createTimerIndicator();
    const badge = el.querySelector(".timer-badge");
    expect(badge).toBeDefined();
  });

  it("displays timer label", () => {
    const el = createTimerIndicator({ label: "3000ms" });
    const span = el.querySelector(".timer-badge span");
    expect(span).toBeDefined();
    expect(span!.textContent).toBe("3000ms");
  });

  it("renders timer icon", () => {
    const el = createTimerIndicator();
    const icon = el.querySelector(".timer-icon");
    expect(icon).toBeDefined();
  });

  it("renders progress bar", () => {
    const el = createTimerIndicator();
    const progress = el.querySelector(".timer-progress");
    expect(progress).toBeDefined();
    const bar = el.querySelector(".timer-progress-bar");
    expect(bar).toBeDefined();
  });

  it("shows correct progress at 50%", () => {
    const el = createTimerIndicator({ duration: 1000, elapsed: 500 });
    const bar = el.querySelector(".timer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("50%");
  });

  it("shows 0% progress at start", () => {
    const el = createTimerIndicator({ duration: 1000, elapsed: 0 });
    const bar = el.querySelector(".timer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("shows 100% progress when complete", () => {
    const el = createTimerIndicator({ duration: 1000, elapsed: 1000 });
    const bar = el.querySelector(".timer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("100%");
  });

  it("caps progress at 100%", () => {
    const el = createTimerIndicator({ duration: 1000, elapsed: 1500 });
    const bar = el.querySelector(".timer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("100%");
  });

  it("shows no progress when duration is 0", () => {
    const el = createTimerIndicator({ duration: 0, elapsed: 0 });
    const bar = el.querySelector(".timer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("running timer has no paused class", () => {
    const el = createTimerIndicator({ status: "running" });
    const badge = el.querySelector(".timer-badge");
    expect(badge!.classList.contains("paused")).toBe(false);
    expect(badge!.classList.contains("cancelled")).toBe(false);
  });

  it("paused timer has paused class", () => {
    const el = createTimerIndicator({ status: "paused" });
    const badge = el.querySelector(".timer-badge");
    expect(badge!.classList.contains("paused")).toBe(true);
  });

  it("cancelled timer has cancelled class", () => {
    const el = createTimerIndicator({ status: "cancelled" });
    const badge = el.querySelector(".timer-badge");
    expect(badge!.classList.contains("cancelled")).toBe(true);
  });

  it("running timer shows pause button", () => {
    const el = createTimerIndicator({ status: "running" });
    const pauseBtn = el.querySelector("[data-action='pause']");
    expect(pauseBtn).toBeDefined();
  });

  it("running timer shows cancel button", () => {
    const el = createTimerIndicator({ status: "running" });
    const cancelBtn = el.querySelector("[data-action='cancel']");
    expect(cancelBtn).toBeDefined();
  });

  it("paused timer shows resume button", () => {
    const el = createTimerIndicator({ status: "paused" });
    const resumeBtn = el.querySelector("[data-action='resume']");
    expect(resumeBtn).toBeDefined();
  });

  it("paused timer shows cancel button", () => {
    const el = createTimerIndicator({ status: "paused" });
    const cancelBtn = el.querySelector("[data-action='cancel']");
    expect(cancelBtn).toBeDefined();
  });

  it("cancelled timer has no controls", () => {
    const el = createTimerIndicator({ status: "cancelled" });
    const controls = el.querySelector(".timer-controls");
    expect(controls).toBeNull();
  });

  it("dispatches timer-action with pause on pause click", () => {
    const el = createTimerIndicator({ status: "running", timerId: "t-42" });
    const handler = vi.fn();
    el.addEventListener("timer-action", handler);
    const pauseBtn = el.querySelector("[data-action='pause']") as HTMLElement;
    pauseBtn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ timerId: "t-42", action: "pause" });
  });

  it("dispatches timer-action with resume on resume click", () => {
    const el = createTimerIndicator({ status: "paused", timerId: "t-99" });
    const handler = vi.fn();
    el.addEventListener("timer-action", handler);
    const resumeBtn = el.querySelector("[data-action='resume']") as HTMLElement;
    resumeBtn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ timerId: "t-99", action: "resume" });
  });

  it("dispatches timer-action with cancel on cancel click", () => {
    const el = createTimerIndicator({ status: "running", timerId: "t-7" });
    const handler = vi.fn();
    el.addEventListener("timer-action", handler);
    const cancelBtn = el.querySelector("[data-action='cancel']") as HTMLElement;
    cancelBtn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ timerId: "t-7", action: "cancel" });
  });

  it("has correct default properties", () => {
    const el = createTimerIndicator();
    expect(el.timerId).toBe("t1");
    expect(el.nodeId).toBe("node-a");
    expect(el.label).toBe("5000ms");
    expect(el.duration).toBe(5000);
    expect(el.elapsed).toBe(0);
    expect(el.status).toBe("running");
  });

  it("timer badge has title with status", () => {
    const el = createTimerIndicator({ label: "2000ms", status: "running" });
    const badge = el.querySelector(".timer-badge") as HTMLElement;
    expect(badge.title).toContain("2000ms");
    expect(badge.title).toContain("running");
  });

  it("re-renders when properties change", () => {
    const el = createTimerIndicator({ status: "running" });
    expect(el.querySelector("[data-action='pause']")).toBeDefined();
    el.status = "paused";
    el.attributeChangedCallback();
    expect(el.querySelector("[data-action='resume']")).toBeDefined();
    expect(el.querySelector("[data-action='pause']")).toBeNull();
  });
});
