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
          "packages/test/src/**",
        ],
        rules: {
          "mantaq/no-try-catch": "error",
          "mantaq/no-throw": "error",
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
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
