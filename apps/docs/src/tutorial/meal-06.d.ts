import { Actor } from "@mantaq/core";
type MealContext = {
  plates: number;
};
export declare const meal6: import("@mantaq/core").Machine<
  "meal6",
  Omit<{}, "clock">,
  Actor<
    readonly [
      import("@mantaq/core").StateRef<"hungry", unknown, false>,
      import("@mantaq/core").StateRef<"full", unknown, true>,
    ],
    readonly [
      import("@mantaq/core").EventRef<"serve", void>,
      import("@mantaq/core").EventRef<
        "eat",
        {
          /**
           * What the person eats.
           * @example soup
           */
          food: string;
        }
      >,
    ],
    readonly [],
    readonly [],
    MealContext,
    undefined
  >
>;
export {};
