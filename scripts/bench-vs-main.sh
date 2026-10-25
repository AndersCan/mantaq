#!/usr/bin/env bash
# Perf regression gate for CI: benchmark the PR against its merge base on the SAME
# machine, so hardware differences cancel and the threshold can be tight.
#
#   1. check out BASE_REF into a scratch worktree
#   2. drop this PR's packages/bench + toolchain pins into it (main may predate bench)
#   3. record baseline timings there (base core, PR harness)
#   4. run the PR against those timings with a tight delta
#
# Sequential runs on shared runners are noisy, so a failed compare is retried
# once; a real regression fails both times.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BASE_REF="${BASE_REF:-origin/main}"
BASE_DIR="$(mktemp -d)/base"
DELTA="${MANTAQ_BENCH_DELTA:-0.25}"
ATTEMPTS="${MANTAQ_BENCH_ATTEMPTS:-2}"

git -C "$ROOT" worktree add --detach "$BASE_DIR" "$BASE_REF"
trap 'git -C "$ROOT" worktree remove --force "$BASE_DIR"' EXIT

rm -rf "$BASE_DIR/packages/bench"
mkdir -p "$BASE_DIR/packages/bench"
(cd "$ROOT/packages/bench" && tar --exclude=node_modules --exclude=.vitest -cf - .) | tar -xf - -C "$BASE_DIR/packages/bench"
cp "$ROOT/pnpm-workspace.yaml" "$ROOT/pnpm-lock.yaml" "$ROOT/package.json" "$BASE_DIR/"

(cd "$BASE_DIR" && vp install --no-frozen-lockfile)
(cd "$BASE_DIR/packages/bench" && MANTAQ_BENCH_WRITE_BASELINE=1 vp test bench)

BASELINE_DIR=".vitest/base"
rm -rf "$ROOT/packages/bench/$BASELINE_DIR"
mkdir -p "$ROOT/packages/bench/$BASELINE_DIR"
cp "$BASE_DIR"/packages/bench/perf/*.json "$ROOT/packages/bench/$BASELINE_DIR/"

cd "$ROOT/packages/bench"
for attempt in $(seq "$ATTEMPTS"); do
  echo "bench vs $BASE_REF: attempt $attempt/$ATTEMPTS (max slowdown ${DELTA}, max alloc growth 0.10)"
  if MANTAQ_BENCH_BASELINE_DIR="$BASELINE_DIR" MANTAQ_BENCH_DELTA="$DELTA" \
    MANTAQ_BENCH_ALLOC_BASELINE="$BASELINE_DIR/alloc.json" vp test bench; then
    exit 0
  fi
done
echo "perf regression vs $BASE_REF confirmed on $ATTEMPTS attempts" >&2
exit 1
