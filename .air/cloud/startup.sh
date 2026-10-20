#!/usr/bin/env bash
# Environment startup for Skill Atlas: a Node (>=24) TypeScript CLI with no server.
# WARMUP (snapshot-baking) runs install + the full CI check; TASK runs only install and returns.
set -euo pipefail

if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then WARMUP=1; else WARMUP=; fi

cd "$(dirname "$0")/../.."

# Mirrors .github/workflows/ci.yml: typecheck, tests, and the real CLI on the fixture repository.
healthcheck() {
  echo "[startup] healthcheck: typecheck"
  npm run typecheck
  echo "[startup] healthcheck: tests"
  npm test
  echo "[startup] healthcheck: CLI smoke"
  ./skill-atlas help
  ./skill-atlas scan ./fixture
  echo "[startup] healthcheck: OK"
}

if ! command -v node >/dev/null 2>&1; then
  echo "[startup] ERROR: node is not on PATH (package.json requires node >=24)" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "[startup] ERROR: node $(node -v) found, package.json requires >=24" >&2
  exit 1
fi
echo "[startup] node $(node -v), npm $(npm -v)"

echo "[startup] npm ci"
npm ci --no-audit --no-fund
echo "[startup] npm ci done"

if [ -n "$WARMUP" ]; then healthcheck; fi
echo "[startup] done"
