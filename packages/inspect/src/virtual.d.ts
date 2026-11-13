declare module "virtual:mantaq/targets" {
  import type { LiveTargets } from "./live-page.ts";
  export const targets: LiveTargets;
  export const previewed: string[];
}

declare module "virtual:mantaq/previews" {
  export const previews: Record<
    string,
    () => Promise<{ default: (element: HTMLElement, state: unknown) => void }>
  >;
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
