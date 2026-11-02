import { VirtualClock } from "@mantaq/core";
import { createTestHarness } from "@mantaq/test";
import { Either } from "@mantaq/utils";
import {
  createMemberList,
  createMembership,
  initialStateFromRecords,
  type MembershipPort,
  type MembershipRecords,
  type MembershipRequest,
} from "./membership.ts";
import { describe, it, expect } from "vite-plus/test";

const empty: MembershipRecords = { memberId: "m1", registry: [], removed: [], outbox: [] };
const ask: MembershipRequest = { memberId: "m1", note: "please" };

function fakePort(verdict: "ok" | "no" | "reject"): {
  port: MembershipPort;
  seen: Array<MembershipRequest>;
} {
  const seen: Array<MembershipRequest> = [];
  return {
    seen,
    port: {
      checkEligibility: (r) => {
        seen.push(r);
        if (verdict === "reject") return Promise.reject(new Error("offline"));
        return Promise.resolve(
          verdict === "ok"
            ? Either.right({ memberId: r.memberId })
            : Either.left({ reason: "banned" }),
        );
      },
    },
  };
}

function setup(records: MembershipRecords, options: { verdict?: "ok" | "no" | "reject" } = {}) {
  const verdict = options.verdict ?? "ok";
  const clock = VirtualClock();
  const { port, seen } = fakePort(verdict);
  const { actor } = createMembership({ port, clock, records });
  const list = createMemberList({ clock, sources: [{ actor }] });
  return { actor, list, seen, harness: createTestHarness(actor) };
}

describe("membership", () => {
  it("request → approve enrolls and feeds the member list", async () => {
    const { actor, list, seen } = setup(empty);
    actor.send({ type: "request", payload: ask });
    await actor.settled();
    expect(actor.state.name).toBe("requestPending");
    expect(seen).toEqual([ask]);
    actor.send({ type: "approve" });
    await actor.settled();
    await list.actor.settled();
    expect(actor.state.name).toBe("enrolled");
    expect(list.actor.context.members).toEqual(["m1"]);
  });

  it("remove ends membership and drops it from the list", async () => {
    const { actor, list } = setup(empty);
    actor.send({ type: "request", payload: ask });
    actor.send({ type: "approve" });
    actor.send({ type: "remove" });
    await actor.settled();
    await list.actor.settled();
    expect(actor.state.name).toBe("removed");
    expect(list.actor.context.members).toEqual([]);
  });

  it("decline returns to notMember and can request again", async () => {
    const { actor } = setup(empty);
    actor.send({ type: "request", payload: ask });
    actor.send({ type: "decline" });
    await actor.settled();
    expect(actor.state.name).toBe("notMember");
    actor.send({ type: "request", payload: ask });
    await actor.settled();
    expect(actor.state.name).toBe("requestPending");
  });

  it("an Either left from the port returns to notMember", async () => {
    const { actor } = setup(empty, { verdict: "no" });
    actor.send({ type: "request", payload: ask });
    await actor.settled();
    expect(actor.state.name).toBe("notMember");
  });

  it("a rejected port call returns to notMember", async () => {
    const { actor } = setup(empty, { verdict: "reject" });
    actor.send({ type: "request", payload: ask });
    await actor.settled();
    expect(actor.state.name).toBe("notMember");
  });
});

describe("membership illegal moves are no-ops", () => {
  it("approve with no request", async () => {
    const { actor, harness, list } = setup(empty);
    harness.send({ type: "approve" });
    await actor.settled();
    expect(actor.state.name).toBe("notMember");
    harness.assertTransitionNeverVisited({ from: "notMember", event: "approve" });
    expect(list.actor.context.members).toEqual([]);
  });

  it("decline when not pending", async () => {
    const { actor, harness } = setup({ ...empty, registry: ["m1"] });
    harness.send({ type: "decline" });
    await actor.settled();
    expect(actor.state.name).toBe("enrolled");
    harness.assertTransitionNeverVisited({ from: "enrolled", event: "decline" });
  });

  it("request after removal", async () => {
    const { actor, harness } = setup({ ...empty, removed: ["m1"] });
    harness.send({ type: "request", payload: ask });
    await actor.settled();
    expect(actor.state.name).toBe("removed");
    harness.assertTransitionNeverVisited({ from: "removed", event: "request" });
  });
});

describe("restore from records", () => {
  it("empty records start at notMember", () => {
    expect(initialStateFromRecords(empty)).toMatchObject({ name: "notMember" });
    expect(setup(empty).actor.state.name).toBe("notMember");
  });

  it("registry starts enrolled", () => {
    expect(setup({ ...empty, registry: ["m1"] }).actor.state.name).toBe("enrolled");
  });

  it("removed wins over registry", () => {
    expect(setup({ ...empty, registry: ["m1"], removed: ["m1"] }).actor.state.name).toBe("removed");
  });

  it("outbox restores the pending request and re-checks it", async () => {
    const { actor, seen } = setup({ ...empty, outbox: [ask] });
    expect(actor.state.name).toBe("requestPending");
    await actor.settled();
    expect(seen).toEqual([ask]);
    actor.send({ type: "approve" });
    await actor.settled();
    expect(actor.state.name).toBe("enrolled");
  });

  it("ignores records about other members", () => {
    const other = { memberId: "m2", note: "x" };
    const records = { ...empty, registry: ["m2"], removed: ["m3"], outbox: [other] };
    expect(setup(records).actor.state.name).toBe("notMember");
  });
});
