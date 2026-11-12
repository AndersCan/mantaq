import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { createDoorLock, enterCode } from "./door-lock";

test("a wrong code leaves the door locked; the right one opens it for 30 seconds", () => {
  const clock = VirtualClock();
  const door = createDoorLock(clock);
  expect(door.snapshot().path).toEqual(["locked"]);

  door.send(enterCode.create({ code: "0000" }));
  expect(door.snapshot().path).toEqual(["locked"]);
  door.send(enterCode.create({ code: "1234" }));
  expect(door.snapshot().path).toEqual(["unlocked"]);

  clock.advance(29_999);
  expect(door.snapshot().path).toEqual(["unlocked"]);
  clock.advance(1);
  expect(door.snapshot().path).toEqual(["locked"]);
});
