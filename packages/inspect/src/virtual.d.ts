declare module "virtual:mantaq/targets" {
  import type { LiveTargets } from "./live-page.ts";
  export const targets: LiveTargets;
}

declare module "virtual:mantaq/documents" {
  import type { VizOutputRoutes } from "@mantaq/viz";
  import type { Overview } from "./astro/overview.ts";
  export const root: string;
  export const documents: Readonly<
    Record<
      string,
      {
        text: string;
        machines: string[];
        findings: { machine: string; kind: string; state: string; message: string }[];
        fuzzed: boolean;
      }
    >
  >;
  export const overview: Overview;
  export const routes: VizOutputRoutes;
}

declare module "virtual:mantaq/astro-client" {}
