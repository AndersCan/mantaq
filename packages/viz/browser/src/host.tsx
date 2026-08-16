/**
 * FixtureHost — one fresh actor per fixture, deterministic pre-script, and
 * the `flow-ready` readiness gate (plan §9.1).
 *
 * Ready means, all at once:
 * - fonts loaded (`document.fonts.status === "loaded"`),
 * - React Flow initialized: rendered node/edge counts match the fixture's
 *   declarations and every node is measured (`getBoundingClientRect().width
 *   > 0`),
 * - the error contract holds (`data-error="true"` exactly for error fixtures),
 * - the actor's pending virtual timers match the fixture's expectation,
 * - 2 consecutive RAF flushes after all of the above.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Snapshot } from "@mantaq/core";
import { StateGraph } from "../../src/components/state-graph.tsx";
import type { FixtureDef, FixtureHost as Host, FixtureTheme } from "../fixtures/index.ts";
import { fixtureList } from "../fixtures/index.ts";
import { fixtureHref } from "./router.tsx";

interface FixtureHostProps {
  fixture: FixtureDef;
  theme: FixtureTheme;
}

function createPreparedHost(fixture: FixtureDef): Host {
  const host = fixture.create();
  fixture.preScript?.(host);
  return host;
}

/** Canvas initialized: rendered counts match the declaration, error
 * attribute matches the fixture contract. */
function graphReady(stage: HTMLElement | null, fixture: FixtureDef): boolean {
  if (stage === null) return false;
  const canvas = stage.querySelector<HTMLElement>("[data-node-count]");
  if (canvas === null) return false;
  const countsOk =
    Number(canvas.dataset.nodeCount) === fixture.declares.nodeCount &&
    Number(canvas.dataset.edgeCount) === fixture.declares.edgeCount;
  const errorAttr = stage.querySelector("[data-error]")?.getAttribute("data-error") ?? null;
  return countsOk && (fixture.errorAtMount ? errorAttr === "true" : errorAttr === null);
}

/** One-shot readiness predicate (plan §9.1): fonts loaded, React Flow
 * initialized, every node measured, pending timers matching. */
function isReady(stage: HTMLElement | null, fixture: FixtureDef, host: Host): boolean {
  if (!graphReady(stage, fixture)) return false;
  if (document.fonts.status !== "loaded") return false;
  const nodes = stage ? Array.from(stage.querySelectorAll<HTMLElement>(".react-flow__node")) : [];
  if (nodes.length > 0 && !nodes.every((node) => node.getBoundingClientRect().width > 0))
    return false;
  if (
    fixture.pendingTimers !== undefined &&
    host.clock.pendingTimers().length !== fixture.pendingTimers
  ) {
    return false;
  }
  return true;
}

/** Active-path flattening (plan §9.5.1): every region contributes its live
 * leaf; ids use the graph-model dot scheme (region names only, no root state
 * prefix). */
function collectActivePaths(snap: Snapshot, prefix = ""): string[] {
  const name = snap.path[snap.path.length - 1] ?? "";
  const here = prefix ? `${prefix}.${name}` : name;
  const regions = Object.entries(snap.regions).flatMap(([regionName, regionSnap]) =>
    collectActivePaths(regionSnap, prefix ? `${prefix}.${regionName}` : regionName),
  );
  return [here, ...regions];
}

export function FixtureHost({ fixture, theme }: FixtureHostProps): ReactNode {
  // Pre-script runs during first render — before StateGraph ever mounts.
  const host = useMemo(() => createPreparedHost(fixture), [fixture]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  // window.__viz bridge — Playwright drives the live actor from the page.
  useEffect(() => {
    const { actor, clock } = host;
    const bridge = {
      send(name: string, payload?: unknown): void {
        const ref = fixture.events?.[name];
        if (ref === undefined) return;
        if ("create" in ref) {
          actor.send(ref.create(payload as never));
        } else {
          actor.send(ref);
        }
      },
      advance(ms: number): void {
        clock.advance(ms);
      },
      getPath(): string[] {
        return collectActivePaths(actor.snapshot());
      },
      getHistoryLen(): number {
        return 0; // timeline ships in Phase 4
      },
    };
    window.__viz = bridge;
    return () => {
      delete window.__viz;
    };
  }, [fixture, host]);

  // flow-ready gate.
  useEffect(() => {
    let canceled = false;
    let raf = 0;
    let flushes = 0;

    const check = (): void => {
      if (canceled) return;
      if (!isReady(stageRef.current, fixture, host)) {
        raf = requestAnimationFrame(check);
        return;
      }
      flushes += 1;
      if (flushes >= 2) {
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(check);
    };

    raf = requestAnimationFrame(check);
    return () => {
      canceled = true;
      cancelAnimationFrame(raf);
    };
  }, [fixture, host]);

  return (
    <div ref={stageRef} className="mtq-viz" data-theme={theme}>
      <header className="meta-bar">
        <span className="meta-title" data-testid="fixture-label">
          {fixture.label}
        </span>
        <span className="meta-source">{fixture.source}</span>
        <nav className="meta-links" aria-label="fixture list">
          {fixtureList.map((candidate) => (
            <a
              key={candidate.id}
              href={fixtureHref(candidate.id, theme)}
              className={candidate.id === fixture.id ? "active" : undefined}
              data-testid={`fixture-link-${candidate.id}`}
            >
              {candidate.id}
            </a>
          ))}
        </nav>
        <a
          href={fixtureHref(fixture.id, theme === "dark" ? "light" : "dark")}
          className="meta-theme"
          data-testid="theme-toggle"
        >
          theme: {theme}
        </a>
      </header>
      <main className="stage-main">
        <StateGraph actor={host.actor} />
      </main>
      <div data-testid="flow-ready" data-ready={ready ? "true" : "false"} />
    </div>
  );
}
