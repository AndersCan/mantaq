// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
import { mantaqViz } from "@mantaq/inspect/astro";
import remarkGfm from "remark-gfm";

// https://astro.build/config
export default defineConfig({
  site: "https://anderscan.github.io",
  base: "/mantaq",
  devToolbar: {
    enabled: false,
  },
  redirects: { "/getting-started/first-machine": "/mantaq/getting-started/test-it/" },
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  vite: {},
  integrations: [
    sitemap({ filter: (page) => !page.endsWith("/design/") }),
    mantaqViz({
      machines: [
        "src/content/docs/checkout.ts",
        "src/content/docs/checkout-with-bugs.ts",
        "src/content/docs/photo-upload.ts",
        "src/content/docs/photo-queue.ts",
        "src/design/out-arrow.ts",
        "src/design/pool.ts",
        "src/design/dropped-message.ts",
        "src/pool/team-inbox.ts",
        "src/pool/kitchen.ts",
        "src/conform/counter-model.ts",
        "src/tutorial/meal-01.ts",
        "src/tutorial/meal-02.ts",
        "src/tutorial/meal-03.ts",
        "src/tutorial/meal-04.ts",
        "src/tutorial/meal-05.ts",
        "src/tutorial/meal-06.ts",
        "src/tutorial/meal-07.ts",
        "src/tutorial/meal-08.ts",
        "src/tutorial/meal-09.ts",
      ],
      // Seeded, so every build draws the same coverage.
      fuzz: { seed: 1, iterations: 5000 },
    }),
    starlight({
      title: "Mantaq",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        alt: "Mantaq",
        replacesTitle: true,
      },
      customCss: [
        "@fontsource-variable/space-grotesk/wght.css",
        "@fontsource-variable/ibm-plex-sans/wght.css",
        "@fontsource/ibm-plex-mono/latin-400.css",
        "./src/styles/theme.css",
        "./src/styles/machine.css",
      ],
      plugins: [
        starlightLlmsTxt({
          projectName: "Mantaq",
          description:
            "Mantaq is a type-safe state machine library for TypeScript, with a live diagram of every machine in a Vite dev server.",
          details: [
            "Set up mantaq in a Vite project (Node.js 22.12 or later):",
            "",
            "1. `npm install @mantaq/core @mantaq/inspect`",
            '2. In `vite.config.ts`: `import { mantaqViz } from "@mantaq/inspect/vite";` and `plugins: [mantaqViz({ machines: "src/**/*.machine.ts" })]`.',
            "3. Write `src/<name>.machine.ts` that exports `create<Name>Actor()` returning `Actor({ inputs, states, initial, setup })` from `@mantaq/core`. The API is in the Reference pages of llms-full.txt.",
            "4. Run the dev server and open `/__mantaq/?machine=<id>` on the port it prints. The id is the export name without `create` and `Actor`, first letter lowercase (`createMealActor` → `meal`). `vite build` writes `dist/__mantaq/viz.json`, which lists every id.",
            "5. Optional: `npx skills add AndersCan/mantaq -y` installs the mantaq skill for most coding agents.",
          ].join("\n"),
        }),
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/anderscan/mantaq" }],
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "This is a state", slug: "getting-started" },
            { label: "A second state", slug: "getting-started/second-state" },
            { label: "Events", slug: "getting-started/events" },
            { label: "Final states", slug: "getting-started/final-states" },
            { label: "Context", slug: "getting-started/context" },
            { label: "Guards", slug: "getting-started/guards" },
            { label: "Effects", slug: "getting-started/effects" },
            { label: "Timers", slug: "getting-started/timers" },
            { label: "Regions", slug: "getting-started/regions" },
            { label: "Test it", slug: "getting-started/test-it" },
            { label: "Start with your coding agent", slug: "getting-started/with-an-agent" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Testing", slug: "guides/actor-testing" },
            { label: "Test Harness", slug: "guides/testing-guide" },
            { label: "Machines in an app", slug: "guides/machines-in-an-app" },
            { label: "Visualizer", slug: "guides/visualizer" },
            { label: "Design gate", slug: "guides/design-gate" },
            { label: "Test an app without mantaq", slug: "guides/app-without-mantaq" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Actors", slug: "core-concepts/actors" },
            { label: "States", slug: "core-concepts/states" },
            { label: "Events", slug: "core-concepts/events" },
            { label: "Effects", slug: "core-concepts/effects" },
            { label: "Context", slug: "core-concepts/context" },
            { label: "Error Handling", slug: "core-concepts/error-handling" },
            { label: "Diagrams", slug: "core-concepts/diagrams" },
          ],
        },
        {
          label: "Sugar",
          items: [
            { label: "Overview", slug: "sugar" },
            { label: "Batch Creation", slug: "sugar/batch-creation" },
            { label: "Matching", slug: "sugar/matching" },
            { label: "Dynamic Children", slug: "sugar/dynamic-children" },
            { label: "Pool", slug: "sugar/pool" },
            { label: "Effect Helpers", slug: "sugar/effect-helpers" },
            { label: "Composition", slug: "sugar/composition" },
            { label: "Request / Response", slug: "sugar/request-response" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "@mantaq/core", slug: "reference/core" },
            { label: "@mantaq/sugar", slug: "reference/sugar" },
            { label: "@mantaq/test", slug: "reference/test" },
            { label: "@mantaq/traversal", slug: "reference/traversal" },
          ],
        },
      ],
    }),
  ],
});
