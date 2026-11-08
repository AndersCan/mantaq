import type { Snapshot } from "@mantaq/core";
import { AsyncDirective } from "lit-html/async-directive.js";
import { html } from "lit-html";
import { directive, PartType, type DirectiveResult, type PartInfo } from "lit-html/directive.js";
import { isDirectiveResult } from "lit-html/directive-helpers.js";

type Watchable<C> = {
  snapshot(): Snapshot<C>;
  on(event: "change", options: { fn: (snapshot: Snapshot<C>) => void }): () => void;
};

type Source = {
  actor: object;
  read: () => unknown;
  listen: (fn: () => void) => () => void;
};

// lit requires directives to be classes (functions-first exception)
class WatchDirective extends AsyncDirective {
  #actor: object | undefined;
  #source: Source | undefined;
  #unsubscribe: (() => void) | undefined;
  readonly #inChild: boolean;

  constructor(info: PartInfo) {
    super(info);
    this.#inChild = info.type === PartType.CHILD;
  }

  render(source: Source): unknown {
    this.#source = source;
    if (source.actor !== this.#actor) {
      this.#stop();
      this.#actor = source.actor;
      if (this.isConnected) this.#start();
    }
    return this.#read(source);
  }

  disconnected(): void {
    this.#stop();
  }

  reconnected(): void {
    this.#start();
    if (this.#source) this.setValue(this.#read(this.#source));
  }

  // A directive returned by `select` gets its own template part, so lit disconnects it when this part is cleared (lit unlinks nested directive chains that get shorter).
  #read(source: Source): unknown {
    const value = source.read();
    return this.#inChild && isDirectiveResult(value) ? html`${value}` : value;
  }

  #start(): void {
    const source = this.#source;
    if (!source || this.#unsubscribe) return;
    let seeding = true;
    this.#unsubscribe = source.listen(() => {
      if (seeding || !this.#source) return;
      this.setValue(this.#read(this.#source));
    });
    seeding = false;
  }

  #stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}

const watchDirective = directive(WatchDirective);

/** Binds a lit part to an actor: renders `select(snapshot)` now and on every change. */
export function watch<C, R>(
  actor: Watchable<C>,
  select: (snapshot: Snapshot<C>) => R,
): DirectiveResult {
  return watchDirective({
    actor,
    read: () => select(actor.snapshot()),
    listen: (fn) => actor.on("change", { fn }),
  });
}
