// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
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
    starlight({
      title: "Mantaq",
      plugins: [
        starlightLlmsTxt({
          projectName: "Mantaq",
        }),
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/anderscan/mantaq" }],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "State Machines & Statecharts", slug: "getting-started/state-machines" },
            { label: "Installation", slug: "getting-started/installation" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Actors", slug: "core-concepts/actors" },
            { label: "States", slug: "core-concepts/states" },
            { label: "Events", slug: "core-concepts/events" },
            { label: "Effects", slug: "core-concepts/effects" },
            { label: "Context", slug: "core-concepts/context" },
            { label: "Error Handling", slug: "core-concepts/error-handling" },
            { label: "Testing", slug: "guides/actor-testing" },
            { label: "Test Harness", slug: "guides/testing-guide" },
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
