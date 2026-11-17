export const odd = {
  id: "odd" as const,
  create: (): {
    send(event: { payload: { n: number } } | { type: "odd.GO"; payload: { k: string } }): void;
    snapshot(): unknown;
    inject(): void;
    settled(): Promise<void>;
  } => {
    throw new Error("not run");
  },
};
export const loose = {
  id: "loose" as const,
  create: (): {
    send(event: unknown): void;
    snapshot(): unknown;
    inject(): void;
    settled(): Promise<void>;
  } => {
    throw new Error("not run");
  },
};
export const none = {
  id: "none" as const,
  create: (): {
    send(): void;
    snapshot(): unknown;
    inject(): void;
    settled(): Promise<void>;
  } => {
    throw new Error("not run");
  },
};
export const wrapped = {
  id: "wrapped" as const,
  create: (): {
    actor: {
      send(event: { type: "wrapped.GO"; payload: { k: string } }): void;
      snapshot(): unknown;
      inject(): void;
      settled(): Promise<void>;
    };
  } => {
    throw new Error("not run");
  },
};
