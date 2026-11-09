// @ts-check
import { defineConfig } from "astro/config";
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
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  vite: {},
  integrations: [
    mantaqViz({
      machines: [
        "src/content/docs/checkout.ts",
        "src/content/docs/saga.ts",
        "src/content/docs/login.ts",
        "src/content/docs/checkout-with-bugs.ts",
        "src/content/docs/photo-upload.ts",
        "src/content/docs/photo-queue.ts",
        "src/first-machine/traffic-light.ts",
        "src/tutorial/order-01.ts",
        "src/tutorial/order-02.ts",
        "src/tutorial/order-03.ts",
        "src/tutorial/order-04.ts",
        "src/tutorial/order-05.ts",
        "src/tutorial/order-06.ts",
        "src/tutorial/order-07.ts",
        "src/tutorial/order-08.ts",
        "src/tutorial/order-09.ts",
      ],
      // Seeded, so every build draws the same coverage. 2000 runs miss the saga's
      // five-step path to `completed` on this seed; 5000 take ~0.3s.
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
      customCss: ["./src/styles/machine.css"],
      plugins: [
        starlightLlmsTxt({
          projectName: "Mantaq",
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
            { label: "Test it", slug: "getting-started/first-machine" },
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
