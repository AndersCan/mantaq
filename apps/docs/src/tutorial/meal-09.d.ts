import { Actor } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
type MealContext = {
  plates: number;
};
/** The person puts food on the stove. */
export declare const cook: import("@mantaq/core").EventRef<"cook", void>;
export declare function createMeal9(clock: Clock): Actor<
  readonly [
    import("@mantaq/core").StateRef<"hungry", unknown, false>,
    import("@mantaq/core").StateRef<"cooking", unknown, false>,
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
    import("@mantaq/core").EventRef<"cook", void>,
  ],
  readonly [
    import("@mantaq/core").EventRef<"cooked", void>,
    import("@mantaq/core").EventRef<"overcooked", void>,
  ],
  readonly [],
  MealContext
>;
export {};
