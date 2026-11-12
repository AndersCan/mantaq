export function createOdd(): {
  send(event: { payload: { n: number } } | { type: "odd.GO"; payload: { k: string } }): void;
  snapshot(): unknown;
  inject(): void;
  settled(): Promise<void>;
} {
  throw new Error("not run");
}
export function createLoose(): {
  send(event: unknown): void;
  snapshot(): unknown;
  inject(): void;
  settled(): Promise<void>;
} {
  throw new Error("not run");
}
export function createNone(): {
  send(): void;
  snapshot(): unknown;
  inject(): void;
  settled(): Promise<void>;
} {
  throw new Error("not run");
}
export function createWrapped(): {
  actor: {
    send(event: { type: "wrapped.GO"; payload: { k: string } }): void;
    snapshot(): unknown;
    inject(): void;
    settled(): Promise<void>;
  };
} {
  throw new Error("not run");
}
