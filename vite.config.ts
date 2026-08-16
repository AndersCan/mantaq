import { defaultExclude, defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  test: {
    // property-test suites register no `it()` (runProperty executes inline) —
    // the package-level configs all set this; the root must too.
    passWithNoTests: true,
    exclude: [...defaultExclude, "packages/viz/browser/**"],
  },
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
          "packages/test/src/**",
        ],
        rules: {
          "mantaq/no-try-catch": "error",
          "mantaq/no-throw": "error",
          "mantaq/no-console": "error",
        },
      },
      {
        // viz core: no console, no throw — but no-try-catch stays OFF: context
        // values are untrusted input, so formatValue/getter handling and
        // buildVizGraph's catch of a throwing buildGraph are the sanctioned
        // untrusted-value boundary (see viz.v2.md §4).
        files: ["packages/viz/src/core/**"],
        rules: {
          "mantaq/no-throw": "error",
          "mantaq/no-console": "error",
        },
      },
      {
        files: [
          "packages/core/src/virtual-clock.ts",
          "packages/core/src/actor.ts",
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
        files: ["packages/test/src/**"],
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
        // Pinned fixture factories are faithful copies of module-private
        // actors in packages/examples — refactoring them for size would
        // create drift. Line/param/complexity limits stay on everywhere else.
        files: ["packages/viz/browser/fixtures/**"],
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
        files: ["packages/test/**"],
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
        files: ["packages/viz/src/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "@mantaq/sugar",
                  message:
                    "@mantaq/viz imports only @mantaq/core, @mantaq/traversal, @mantaq/utils",
                },
                {
                  name: "@mantaq/test",
                  message:
                    "@mantaq/viz imports only @mantaq/core, @mantaq/traversal, @mantaq/utils",
                },
                { name: "@mantaq/pbt", message: "@mantaq/viz may not import @mantaq/pbt from src" },
              ],
            },
          ],
        },
      },
      {
        // framework-agnostic guarantee: nothing in viz core may import React,
        // the flow library, or any DOM-only widget. Typechecking in a node env
        // would catch most of this; the lint makes it structural.
        files: ["packages/viz/src/core/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "react", message: "@mantaq/viz/core is framework-agnostic — no react" },
                {
                  name: "react-dom",
                  message: "@mantaq/viz/core is framework-agnostic — no react-dom",
                },
                {
                  name: "@xyflow/react",
                  message: "@mantaq/viz/core is framework-agnostic — no @xyflow/react",
                },
                {
                  name: "lucide-react",
                  message: "@mantaq/viz/core is framework-agnostic — no lucide-react",
                },
                { name: "clsx", message: "@mantaq/viz/core is framework-agnostic — no clsx" },
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
      {
        files: ["packages/sugar/tests/**"],
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
