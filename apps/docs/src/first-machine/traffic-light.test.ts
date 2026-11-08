import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { createTrafficLight, switchOff } from "./traffic-light";

test("the light changes colour as time passes, and stays off once switched off", () => {
  const clock = VirtualClock();
  const light = createTrafficLight(clock);
  expect(light.snapshot().path).toEqual(["red"]);

  clock.advance(29_999);
  expect(light.snapshot().path).toEqual(["red"]);
  clock.advance(1);
  expect(light.snapshot().path).toEqual(["green"]);
  clock.advance(25_000);
  expect(light.snapshot().path).toEqual(["yellow"]);
  clock.advance(5_000);
  expect(light.snapshot().path).toEqual(["red"]);

  light.send(switchOff.create());
  expect(light.snapshot().path).toEqual(["off"]);
  clock.advance(60_000);
  expect(light.snapshot().path).toEqual(["off"]);
});
