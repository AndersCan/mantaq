import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "mantaq", specifier: "./scripts/oxlint-plugin.mjs" },
    ],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    ignorePatterns: ["apps/docs/**"],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/no-explicit-any": "error",
      "import/no-cycle": "error",
      "import/no-self-import": "error",
      "import/no-duplicates": "error",
      "eslint/complexity": ["error", { max: 12 }],
      "eslint/max-lines-per-function": ["error", { max: 120 }],
      "eslint/max-depth": ["error", { max: 4 }],
      "eslint/max-params": ["error", { max: 4 }],
      "eslint/max-nested-callbacks": ["error", { max: 4 }],
    },
    overrides: [
      {
        files: [
          "packages/core/src/**",
          "packages/sugar/src/**",
          "packages/traversal/src/**",
          "packages/testkit/src/**",
        ],
        rules: {
          "mantaq/no-try-catch": "error",
          "mantaq/no-throw": "error",
          "mantaq/no-console": "error",
        },
      },
      {
        files: [
          "packages/core/src/virtual-clock.ts",
          "packages/core/src/actor.ts",
          "packages/core/src/builder.ts",
          "packages/sugar/src/actors/actor-map.ts",
          "packages/traversal/src/graph.ts",
        ],
        rules: {
          // Programmer-error validation sites — these throw per the no-console
          // rule (NaN/Infinity clock input, undeclared initial state,
          // unregistered regions, registry LEFTs, malformed graphs). Runtime
          // error flow still uses Either + the error state, never thrown.
          "mantaq/no-throw": "off",
        },
      },
      {
        // Directed tests simulate programmer-bug explosions inside handlers to
        // prove the machine contains them; the throw lives in a guard-shaped
        // isErrorBomb helper in each of these files.
        files: [
          "packages/core/src/actor-error.property.test.ts",
          "packages/core/src/actor.error.test.ts",
          "packages/core/src/core.mutation.test.ts",
          "packages/core/src/infrastructure.mutation.test.ts",
          "packages/core/src/recover.test.ts",
          "packages/core/src/snapshot.property.test.ts",
          "packages/core/src/unit.test.ts",
          "packages/traversal/src/graph.test.ts",
        ],
        rules: {
          "mantaq/no-throw": "off",
        },
      },
      {
        files: ["packages/testkit/src/**"],
        // assertion APIs must throw to fail the test — that is their error flow
        rules: {
          "mantaq/no-throw": "off",
        },
      },
      {
        files: ["packages/utils/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "@mantaq/core",
                  message: "@mantaq/utils is zero-dependency and imports no @mantaq packages",
                },
                {
                  name: "@mantaq/sugar",
                  message: "@mantaq/utils is zero-dependency and imports no @mantaq packages",
                },
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/utils is zero-dependency and imports no @mantaq packages",
                },
                {
                  name: "@mantaq/test",
                  message: "@mantaq/utils is zero-dependency and imports no @mantaq packages",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["**/*.test.ts"],
        rules: {
          "eslint/max-lines-per-function": "off",
          "eslint/max-depth": "off",
          "eslint/max-params": "off",
          "eslint/max-nested-callbacks": "off",
          "eslint/complexity": "off",
        },
      },
      {
        files: ["packages/core/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "@mantaq/core", message: "@mantaq/core may not import itself" },
                { name: "@mantaq/sugar", message: "@mantaq/core may not import @mantaq/sugar" },
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/core may not import @mantaq/traversal",
                },
                { name: "@mantaq/test", message: "@mantaq/core may not import @mantaq/test" },
                { name: "@mantaq/pbt", message: "@mantaq/core may not import @mantaq/pbt" },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/sugar/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "@mantaq/sugar", message: "@mantaq/sugar imports only @mantaq/core" },
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/sugar may not import @mantaq/traversal",
                },
                { name: "@mantaq/test", message: "@mantaq/sugar may not import @mantaq/test" },
                { name: "@mantaq/pbt", message: "@mantaq/sugar may not import @mantaq/pbt" },
              ],
            },
          ],
        },
      },
      {
        // Colocated sugar tests keep the old packages/sugar/tests semantics:
        // @mantaq/core and @mantaq/pbt allowed, everything else banned.
        files: ["packages/sugar/src/**/*.test.ts"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "@mantaq/sugar", message: "@mantaq/sugar imports only @mantaq/core" },
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/sugar may not import @mantaq/traversal",
                },
                { name: "@mantaq/test", message: "@mantaq/sugar may not import @mantaq/test" },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/traversal/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "@mantaq/sugar",
                  message: "@mantaq/traversal may not import @mantaq/sugar",
                },
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/traversal imports only @mantaq/core",
                },
                { name: "@mantaq/test", message: "@mantaq/traversal may not import @mantaq/test" },
                { name: "@mantaq/pbt", message: "@mantaq/traversal may not import @mantaq/pbt" },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/testkit/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "@mantaq/sugar", message: "@mantaq/test may not import @mantaq/sugar" },
                {
                  name: "@mantaq/test",
                  message: "@mantaq/test imports only @mantaq/core and @mantaq/traversal",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/examples/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/examples may not import @mantaq/traversal",
                },
                { name: "@mantaq/test", message: "@mantaq/examples may not import @mantaq/test" },
              ],
            },
          ],
        },
      },
      {
        // functions-first: stateful resources (Actor, VirtualClock) became
        // factory functions whose helpers share closure state. The whole
        // resource is intentionally one function; per-function line limits
        // do not apply to it.
        files: ["packages/core/src/actor.ts", "packages/core/src/virtual-clock.ts"],
        rules: {
          "eslint/max-lines-per-function": "off",
        },
      },
      {
        // Colocated tests live beside their source now. They keep the old
        // packages/core/tests semantics: @mantaq/pbt allowed (property tests),
        // no-console allowed (mutation fixtures observe output), structure
        // limits off.
        files: ["packages/core/src/**/*.test.ts"],
        rules: {
          "mantaq/no-console": "off",
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "@mantaq/core", message: "@mantaq/core may not import itself" },
                { name: "@mantaq/sugar", message: "@mantaq/core may not import @mantaq/sugar" },
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/core may not import @mantaq/traversal",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/core/tests/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "@mantaq/core", message: "@mantaq/core may not import itself" },
                { name: "@mantaq/sugar", message: "@mantaq/core may not import @mantaq/sugar" },
                {
                  name: "@mantaq/traversal",
                  message: "@mantaq/core may not import @mantaq/traversal",
                },
              ],
            },
          ],
        },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
