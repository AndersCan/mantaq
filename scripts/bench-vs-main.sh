#!/usr/bin/env bash
# Perf regression gate for CI: benchmark this checkout against its merge base on the
# SAME machine. Runs alternate base, PR, base, PR, ... in separate processes (so JIT
# state never leaks between them) and bench-compare.mjs compares the BEST run of each
# side. Best-of-N discards scheduler/neighbour noise, which only ever slows a run down,
# so the limit can be tight (25% time, 50% + 256B allocation; see bench-compare.mjs).
#
# BASE_REF may predate packages/bench, so the base gets a copy of this checkout's
# packages/bench, lockfile and toolchain pins; only its packages/*/src is exercised.
# If the PR changes the core API, the copied workloads cannot run on the base: then
# the base keeps its own packages/bench (same workload names, its own API).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BASE_REF="${BASE_REF:-origin/main}"
ROUNDS="${MANTAQ_BENCH_ROUNDS:-3}"
BASE_DIR="$(mktemp -d)/base"

git -C "$ROOT" worktree add --detach "$BASE_DIR" "$BASE_REF"
trap 'git -C "$ROOT" worktree remove --force "$BASE_DIR"' EXIT

OWN_BENCH="$(mktemp -d)/bench"
[ -d "$BASE_DIR/packages/bench" ] && mv "$BASE_DIR/packages/bench" "$OWN_BENCH"
mkdir -p "$BASE_DIR/packages/bench"
(cd "$ROOT/packages/bench" && tar --exclude=node_modules --exclude=.vitest -cf - .) | tar -xf - -C "$BASE_DIR/packages/bench"
cp "$ROOT/pnpm-workspace.yaml" "$ROOT/pnpm-lock.yaml" "$ROOT/package.json" "$BASE_DIR/"
(cd "$BASE_DIR" && vp install --no-frozen-lockfile)

# Probe: one throwaway run. Workloads written against the PR's API throw on the base.
if [ -d "$OWN_BENCH" ] && ! (cd "$BASE_DIR/packages/bench" && MANTAQ_BENCH_OUT=".vitest/probe" vp test bench >/dev/null 2>&1); then
  echo "PR bench workloads do not run on $BASE_REF; using its own packages/bench"
  rm -rf "$BASE_DIR/packages/bench"
  mv "$OWN_BENCH" "$BASE_DIR/packages/bench"
  (cd "$BASE_DIR" && vp install --no-frozen-lockfile)
fi

RESULTS="$(mktemp -d)"
for round in $(seq "$ROUNDS"); do
  for side in base pr; do
    dir="$ROOT/packages/bench"
    [ "$side" = base ] && dir="$BASE_DIR/packages/bench"
    echo "bench round $round/$ROUNDS: $side"
    (cd "$dir" && rm -rf ".vitest/out" && MANTAQ_BENCH_OUT=".vitest/out" vp test bench >/dev/null)
    mkdir -p "$RESULTS/$side/$round"
    cp "$dir"/.vitest/out/*.json "$RESULTS/$side/$round/"
  done
done

node "$ROOT/scripts/bench-compare.mjs" "$RESULTS" "$BASE_REF"
