/**
 * Fixture gallery entry — parse the route, mount the FixtureHost.
 * Chrome is deterministic: fixed fonts (bundled fontsource), neutral page.
 */

import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "../../src/styles/styles.css";
import "./global.css";
import { parseRoute } from "./router.tsx";
import { getFixture } from "../fixtures/index.ts";
import { FixtureHost } from "./host.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("fixture harness: #root not found");

const route = parseRoute(window.location.search);
const fixture = getFixture(route.fixtureId);

if (!fixture) {
  createRoot(root).render(
    <main className="page">
      <h1>@mantaq/viz fixture gallery</h1>
      <p data-testid="unknown-fixture">unknown fixture: {route.fixtureId}</p>
    </main>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <FixtureHost fixture={fixture} theme={route.theme} />
    </StrictMode>,
  );
}
