import { Actor } from "@mantaq/core";
/** A kitchen that tells a waiter a dish is ready. A waiter on a break has no handler for it, so the dish is dropped. */
export declare const cookMachine: import("@mantaq/core").Machine<
  "cook",
  Omit<{}, "clock">,
  {
    actor: Actor<
      readonly [import("@mantaq/core").StateRef<"cooking", unknown, false>],
      readonly [import("@mantaq/core").EventRef<"DISH_COOKED", void>],
      readonly [],
      readonly [import("@mantaq/core").EventRef<"DISH_READY", void>],
      Record<string, unknown>,
      undefined
    >;
    waiter: Actor<
      readonly [
        import("@mantaq/core").StateRef<"serving", unknown, false>,
        import("@mantaq/core").StateRef<"carryingDish", unknown, false>,
        import("@mantaq/core").StateRef<"onBreak", unknown, false>,
      ],
      readonly [
        import("@mantaq/core").EventRef<"DISH_READY", void>,
        import("@mantaq/core").EventRef<"DISH_SERVED", void>,
        import("@mantaq/core").EventRef<"BREAK_STARTED", void>,
        import("@mantaq/core").EventRef<"BREAK_ENDED", void>,
      ],
      readonly [],
      readonly [],
      Record<string, unknown>,
      undefined
    >;
  }
>;
