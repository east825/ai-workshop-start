#!/usr/bin/env bash
set -euo pipefail

pids=$(lsof -ti tcp:3000 || true)

if [ -z "$pids" ]; then
  echo "No process listening on port 3000"
  exit 0
fi

echo "Killing process(es) on port 3000: $pids"
kill -9 $pids
