#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

docker run --rm \
  -v "$ROOT_DIR":/srv/jekyll \
  -w /srv/jekyll \
  jekyll/jekyll:latest \
  sh -lc "bundle config set path vendor/bundle && bundle install && bundle exec jekyll build"

bun run "$ROOT_DIR/scripts/generate-pages-plan-archive.ts" \
  --destination docs \
  --baseurl /vlunWorkbench
