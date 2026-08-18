#!/usr/bin/env bash
# Vercel "Ignored Build Step" - pasted into Vercel Project Settings ->
# Build & Development Settings -> Ignored Build Step as:
#
#   bash scripts/vercel-ignore-build.sh
#
# Vercel's convention for this hook: exit code 0 means "skip this build/
# deployment", any other exit code means "proceed with the build". See
# https://vercel.com/docs/deployments/skip-deployments (Vercel docs).
#
# Why this exists: .github/workflows/daily-oversize-monitor.yml commits to
# `data/oversize/**` every morning, and every push to `main` otherwise
# triggers a full production build+deploy on Vercel - completely wasteful
# for a commit that only touched raw JSON data no page ever reads at build
# time. This script inspects the commit's actual changed files and tells
# Vercel to skip the deploy when NOTHING outside data/oversize/ changed.
#
# Safe-by-default: if anything goes wrong determining the diff (e.g. a
# shallow clone without a resolvable previous commit), this exits non-zero
# and lets the build proceed - a wasted build is harmless, a wrongly
# skipped production deploy is not.

set -uo pipefail

if ! git rev-parse HEAD~1 >/dev/null 2>&1; then
  echo "No previous commit to diff against - proceeding with the build."
  exit 1
fi

if git diff --quiet HEAD~1 HEAD -- . ':!data/oversize'; then
  echo "Only data/oversize/** changed in this commit - skipping this deployment."
  exit 0
else
  echo "Site-relevant files changed - proceeding with the build."
  exit 1
fi
