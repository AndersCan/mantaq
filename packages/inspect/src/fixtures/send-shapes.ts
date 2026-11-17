/** Only the types matter here: the analysis reads them and never calls this. */
export const shapes = {
  id: "shapes" as const,
  create: (): {
    send(
      event:
        | { type: string; payload: { wide: number } }
        | { type: "shapes.GO"; payload: void }
        | { type: "shapes.PLAIN" }
        | { type: "shapes.PICK"; payload: { n: number } },
    ): void;
    snapshot(): unknown;
    inject(): void;
    settled(): Promise<void>;
  } => {
    throw new Error("not run");
  },
};
