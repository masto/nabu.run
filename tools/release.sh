#!/bin/sh
# Build nabu.run from what's committed, and deploy it.
#
# The build is made from a fresh export of HEAD, so nothing from the
# development setup gets in: not .env.local, not untracked files in public/,
# not uncommitted changes. Dependencies come from package-lock.json (npm ci,
# which also fails if it doesn't match package.json), and lint and tests
# have to pass.
#
# Where it goes is up to you, as an rsync destination in
# NABU_RUN_DEPLOY_TARGET (e.g. user@host:nabu.run/). Without it, the
# release is just built and checked.
#
# usage: tools/release.sh         build, and show what deploying would change
#        tools/release.sh --go    build, and deploy
set -e

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "note: these uncommitted changes won't be in the release:" >&2
  git status --short --untracked-files=no >&2
fi
VERSION=$(node -p "require('./package.json').version")
COMMIT=$(git rev-parse --short HEAD)
echo "building nabu.run $VERSION from $COMMIT" >&2

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git archive HEAD | tar -x -C "$WORK"
cd "$WORK"

npm ci --no-audit --no-fund --loglevel=error
npm run --silent lint
npm test -- --reporter=dot
npm run --silent build

# A development setting in the build would point it at this computer.
if grep -rIl 'localhost' build >&2; then
  echo "error: the build mentions localhost; not deploying" >&2
  exit 1
fi

if [ -z "$NABU_RUN_DEPLOY_TARGET" ]; then
  echo "built and checked $VERSION; set NABU_RUN_DEPLOY_TARGET to deploy it" >&2
  exit 0
fi

DRY=-n
[ "$1" = "--go" ] && DRY=

# --checksum: a fresh build has new file times, so compare contents instead.
# --delete: the build is the whole site, and this clears out old bundles.
rsync -rlpiz --checksum --delete $DRY build/ "$NABU_RUN_DEPLOY_TARGET"
if [ -n "$DRY" ]; then
  echo "(dry run; re-run with --go to deploy $VERSION)" >&2
else
  echo "deployed nabu.run $VERSION ($COMMIT) to $NABU_RUN_DEPLOY_TARGET" >&2
fi
