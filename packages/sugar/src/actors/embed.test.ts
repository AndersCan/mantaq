import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import type { InternalEvent, Snapshot } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { embed } from "./embed.ts";
import { withTimeout } from "../effects/timeout.ts";

const working = state("working")();
const passed = state("passed")().final();
const failed = state("failed")().final();
const finish = event("finish")();
const progress = event("progress")<{ percent: number }>();

interface CheckOptions {
  outcome: "passed" | "failed" | "starts passed";
  waitMs: number;
}

function checkMachine(options: CheckOptions) {
  const ending = options.outcome === "failed" ? failed : passed;
  const initial = options.outcome === "starts passed" ? passed : working;
  return machine("check", {
    create: ({ clock }) =>
      Actor({
        inputs: [],
        internal: [finish],
        outputs: [progress],
        states: [working, passed, failed],
        initial,
        clock,
        setup: (builder) => {
          builder.effect(working, {
            name: "wait",
            sends: [finish],
            fn: (input) => withTimeout(options.waitMs, { input, event: () => finish.create() }),
          });
          builder.on(working, {
            event: finish,
            to: [passed, failed],
            handler: () => ({ state: ending, emit: [progress.create({ percent: 100 })] }),
          });
        },
      }),
  });
}

const idle = state("idle")();
const checking = state("checking")();
const accepted = state("accepted")();
const rejected = state("rejected")();
const broken = state("broken")();
const start = event("start")();
const cancel = event("cancel")();
const checkPassed = event("checkPassed")();
const checkFailed = event("checkFailed")();
const checkBroke = event("checkBroke")();

function parentOf(check: ReturnType<typeof checkMachine>) {
  const clock = VirtualClock();
  const outputs: InternalEvent[] = [];
  const actor = Actor({
    inputs: [start, cancel],
    internal: [checkPassed, checkFailed, checkBroke],
    outputs: [progress],
    states: [idle, checking, accepted, rejected, broken],
    initial: idle,
    clock,
    setup: (builder) => {
      builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
      embed(builder, {
        in: checking,
        machine: check,
        done: { passed: checkPassed, failed: checkFailed },
        error: checkBroke,
      });
      builder.on(checking, {
        event: checkPassed,
        to: [accepted],
        handler: () => ({ state: accepted }),
      });
      builder.on(checking, {
        event: checkFailed,
        to: [rejected],
        handler: () => ({ state: rejected }),
      });
      builder.on(checking, { event: checkBroke, to: [broken], handler: () => ({ state: broken }) });
      builder.on(checking, { event: cancel, to: [idle], handler: () => ({ state: idle }) });
      builder.on(accepted, { event: start, to: [checking], handler: () => ({ state: checking }) });
    },
  });
  actor.on("output", { fn: (output) => outputs.push(output) });
  return { actor, clock, outputs };
}

const fetched = machine("fetched", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      internal: [finish],
      states: [working, passed, failed],
      initial: working,
      clock,
      setup: (builder) => {
        builder.effect(working, {
          name: "fetch",
          sends: [finish],
          fn: (input) => Promise.resolve().then(() => input.emit(finish.create())),
        });
        builder.on(working, { event: finish, to: [passed], handler: () => ({ state: passed }) });
      },
    }),
});

const fetching = state("fetching")();
const fetchDone = event("fetchDone")();

const waitThenFetch = machine("waitThenFetch", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      internal: [finish, fetchDone],
      states: [working, fetching, passed],
      initial: working,
      clock,
      setup: (builder) => {
        builder.effect(working, {
          name: "wait",
          sends: [finish],
          fn: (input) => withTimeout(50, { input, event: () => finish.create() }),
        });
        builder.on(working, {
          event: finish,
          to: [fetching],
          handler: () => ({ state: fetching }),
        });
        builder.effect(fetching, {
          name: "fetch",
          sends: [fetchDone],
          fn: (input) =>
            new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
              input.emit(fetchDone.create()),
            ),
        });
        builder.on(fetching, {
          event: fetchDone,
          to: [passed],
          handler: () => ({ state: passed }),
        });
      },
    }),
});

describe("embed", () => {
  test("parent settled() waits for the async work of the child", async () => {
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkFailed, checkBroke],
      states: [idle, checking, accepted, rejected, broken],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        embed(builder, {
          in: checking,
          machine: fetched,
          done: { passed: checkPassed, failed: checkFailed },
          error: checkBroke,
        });
        builder.on(checking, {
          event: checkPassed,
          to: [accepted],
          handler: () => ({ state: accepted }),
        });
      },
    });
    actor.send(start.create());

    await actor.settled();

    expect(actor.state.name).toBe("accepted");
  });

  test("parent settled() does not wait for child async work that a later timer starts", async () => {
    const clock = VirtualClock();
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkBroke],
      states: [idle, checking, accepted, broken],
      initial: idle,
      clock,
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        embed(builder, {
          in: checking,
          machine: waitThenFetch,
          done: { passed: checkPassed },
          error: checkBroke,
        });
        builder.on(checking, {
          event: checkPassed,
          to: [accepted],
          handler: () => ({ state: accepted }),
        });
      },
    });
    actor.send(start.create());
    await actor.settled();
    clock.advance(50);
    await actor.settled();
    const settledState = actor.state.name;
    await new Promise((resolve) => setTimeout(resolve, 1));

    expect([settledState, actor.state.name]).toEqual(["checking", "accepted"]);
  });

  test("a child final state sends its mapped event, after the child outputs of that step", () => {
    const { actor, clock, outputs } = parentOf(checkMachine({ outcome: "failed", waitMs: 50 }));
    actor.send(start.create());
    clock.advance(49);
    const before = { state: actor.state.name, outputs: [...outputs] };
    clock.advance(1);

    expect([before, { state: actor.state.name, outputs }]).toEqual([
      { state: "checking", outputs: [] },
      { state: "rejected", outputs: [{ type: "progress", payload: { percent: 100 } }] },
    ]);
  });

  test("leaving the state disposes the child, so its timer never fires", () => {
    const { actor, clock, outputs } = parentOf(checkMachine({ outcome: "passed", waitMs: 50 }));
    actor.send(start.create());
    actor.send(cancel.create());

    clock.advance(100);

    expect({ state: actor.state.name, pending: clock.hasPending(), outputs }).toEqual({
      state: "idle",
      pending: false,
      outputs: [],
    });
  });

  test("entering the state again builds a fresh child", () => {
    const { actor, clock } = parentOf(checkMachine({ outcome: "passed", waitMs: 50 }));
    actor.send(start.create());
    clock.advance(50);
    actor.send(start.create());
    clock.advance(10);
    const before = actor.state.name;
    clock.advance(40);

    expect([before, actor.state.name]).toEqual(["checking", "accepted"]);
  });

  test("a child that starts in a final state sends its event on entry", () => {
    const { actor } = parentOf(checkMachine({ outcome: "starts passed", waitMs: 50 }));

    actor.send(start.create());

    expect(actor.state.name).toBe("accepted");
  });

  test("the effect fn carries the machine and the mapping, and sends lists the mapped events", () => {
    const check = checkMachine({ outcome: "passed", waitMs: 50 });
    const { actor } = parentOf(check);
    const [entry] = actor.options.effects["checking"] ?? [];

    expect({
      name: entry?.name,
      sends: entry?.sends,
      embedded: Reflect.get(entry?.fn ?? {}, "embedded"),
    }).toEqual({
      name: "embed:check",
      sends: ["checkPassed", "checkFailed", "checkBroke"],
      embedded: {
        machine: check,
        done: { passed: "checkPassed", failed: "checkFailed" },
        error: "checkBroke",
        forward: [],
        snapshot: undefined,
      },
    });
  });
});

const uploading = state("uploading")();
const couldNotUpload = state("couldNotUpload")();
const uploaded = state("uploaded")().final();
const dismissed = state("dismissed")().final();
const uploadSettled = event("uploadSettled")();
const retry = event("retry")();
const dismiss = event("dismiss")();

interface UploadOptions {
  failures: number;
}

/** Each attempt takes 50 ms. The first `failures` attempts of each child fail; the user retries or dismisses. */
function uploadMachine(options: UploadOptions) {
  return machine("upload", {
    create: ({ clock }) => {
      let attempts = 0;
      return Actor({
        inputs: [retry, dismiss],
        internal: [uploadSettled],
        states: [uploading, couldNotUpload, uploaded, dismissed],
        initial: uploading,
        clock,
        setup: (builder) => {
          builder.effect(uploading, {
            name: "upload",
            sends: [uploadSettled],
            fn: (input) => withTimeout(50, { input, event: () => uploadSettled.create() }),
          });
          builder.on(uploading, {
            event: uploadSettled,
            to: [uploaded, couldNotUpload],
            handler: () => {
              attempts += 1;
              return { state: attempts > options.failures ? uploaded : couldNotUpload };
            },
          });
          builder.on(couldNotUpload, {
            event: retry,
            to: [uploading],
            handler: () => ({ state: uploading }),
          });
          builder.on(couldNotUpload, {
            event: dismiss,
            to: [dismissed],
            handler: () => ({ state: dismissed }),
          });
        },
      });
    },
  });
}

const editing = state("editing")();
const saving = state("saving")();
const saved = state("saved")();
const save = event("save")();
const uploadDone = event("uploadDone")();
const uploadDismissed = event("uploadDismissed")();
const uploadBroke = event("uploadBroke")();
const uploadChanged = event("uploadChanged")<Snapshot>();

interface EditorContext {
  upload: Snapshot | undefined;
}

interface EditorOptions {
  initial: "editing" | "saving";
}

function editorOf(upload: ReturnType<typeof uploadMachine>, options?: EditorOptions) {
  const clock = VirtualClock();
  const snapshots: string[][] = [];
  const context: EditorContext = { upload: undefined };
  const actor = Actor({
    inputs: [save, retry, dismiss],
    internal: [uploadDone, uploadDismissed, uploadBroke, uploadChanged],
    states: [editing, saving, saved, broken],
    initial: options?.initial === "saving" ? saving : editing,
    context,
    clock,
    setup: (builder) => {
      builder.on(editing, { event: save, to: [saving], handler: () => ({ state: saving }) });
      embed(builder, {
        in: saving,
        machine: upload,
        done: { uploaded: uploadDone, dismissed: uploadDismissed },
        error: uploadBroke,
        forward: [retry, dismiss],
        snapshot: uploadChanged,
      });
      builder.on(saving, {
        event: uploadChanged,
        handler: (changed, { context: editor }) => {
          snapshots.push(changed.payload.path);
          editor.set({ upload: changed.payload });
        },
      });
      builder.on(saving, { event: uploadDone, to: [saved], handler: () => ({ state: saved }) });
      builder.on(saving, {
        event: uploadDismissed,
        to: [editing],
        handler: () => ({ state: editing }),
      });
      builder.on(saving, {
        event: uploadBroke,
        to: [broken],
        handler: () => ({ state: broken }),
      });
    },
  });
  return { actor, clock, snapshots };
}

describe("embed forward", () => {
  test("a forwarded input moves the child, and the child end moves the parent", () => {
    const { actor, clock } = editorOf(uploadMachine({ failures: 1 }));
    actor.send(save.create());
    clock.advance(50);
    actor.send(retry.create());
    const retrying = actor.state.name;
    clock.advance(50);

    expect([retrying, actor.state.name]).toEqual(["saving", "saved"]);
  });

  test("dismiss reaches the child, and its dismissed state sends its done event", () => {
    const { actor, clock } = editorOf(uploadMachine({ failures: 1 }));
    actor.send(save.create());
    clock.advance(50);

    actor.send(dismiss.create());

    expect({ state: actor.state.name, pending: clock.hasPending() }).toEqual({
      state: "editing",
      pending: false,
    });
  });

  test("the snapshot event carries the child path on entry and on each change", () => {
    const { actor, clock, snapshots } = editorOf(uploadMachine({ failures: 1 }));
    actor.send(save.create());
    clock.advance(50);
    actor.send(retry.create());
    clock.advance(50);

    expect(snapshots).toEqual([["uploading"], ["couldNotUpload"], ["uploading"], ["uploaded"]]);
  });

  test("a parent that starts in the embedding state holds the child snapshot in its own snapshot", () => {
    const { actor, clock } = editorOf(uploadMachine({ failures: 1 }), { initial: "saving" });
    const built = actor.snapshot().context.upload?.path;
    clock.advance(50);

    expect([built, actor.snapshot().context.upload?.path]).toEqual([
      ["uploading"],
      ["couldNotUpload"],
    ]);
  });

  test("a forwarded input outside the embedding state reaches no child", () => {
    const { actor, clock, snapshots } = editorOf(uploadMachine({ failures: 1 }));
    actor.send(retry.create());
    actor.send(save.create());
    clock.advance(50);

    expect({ state: actor.state.name, snapshots }).toEqual({
      state: "saving",
      snapshots: [["uploading"], ["couldNotUpload"]],
    });
  });

  test("entering the state again forwards to the fresh child", () => {
    const { actor, clock } = editorOf(uploadMachine({ failures: 1 }));
    actor.send(save.create());
    clock.advance(50);
    actor.send(dismiss.create());
    actor.send(save.create());
    clock.advance(50);
    const failedAgain = actor.state.name;
    actor.send(retry.create());
    clock.advance(50);

    expect([failedAgain, actor.state.name]).toEqual(["saving", "saved"]);
  });

  test("the tag lists the forwarded inputs and the snapshot event, and sends lists the snapshot event", () => {
    const upload = uploadMachine({ failures: 0 });
    const { actor } = editorOf(upload);
    const [entry] = actor.options.effects["saving"] ?? [];

    expect({
      sends: entry?.sends,
      embedded: Reflect.get(entry?.fn ?? {}, "embedded"),
      targets: actor.options.targets["saving"],
    }).toEqual({
      sends: ["uploadDone", "uploadDismissed", "uploadBroke", "uploadChanged"],
      embedded: {
        machine: upload,
        done: { uploaded: "uploadDone", dismissed: "uploadDismissed" },
        error: "uploadBroke",
        forward: ["retry", "dismiss"],
        snapshot: "uploadChanged",
      },
      targets: {
        retry: [],
        dismiss: [],
        uploadChanged: [],
        uploadDone: ["saved"],
        uploadDismissed: ["editing"],
        uploadBroke: ["broken"],
      },
    });
  });
});
