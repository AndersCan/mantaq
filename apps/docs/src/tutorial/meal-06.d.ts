import { Actor } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
type MealContext = {
  plates: number;
};
export declare function createMeal6(clock: Clock): Actor<
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
  MealContext
>;
export {};
