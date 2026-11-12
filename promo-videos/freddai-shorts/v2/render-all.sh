#!/usr/bin/env bash
cd "$(dirname "$0")"
for id in "$@"; do ./render-one.sh "$id" || echo "FAILED $id"; done
