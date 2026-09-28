#!/bin/sh
# Build nabu.run from what's committed, and deploy it.
#
# The build is made from a fresh export of HEAD, so nothing from the
# development setup gets in: not .env.local, not untracked files in public/,
# not uncommitted changes. Dependencies come from package-lock.json (npm ci,
# which also fails if it doesn't match package.json), and lint and tests
# have to pass.
#
# It goes to Cloudflare Workers as static assets (see wrangler.jsonc), which
# needs wrangler to be logged in (npx wrangler login) or
# CLOUDFLARE_API_TOKEN set. Every deploy is the whole site.
#
# usage: tools/release.sh         build, and upload a preview version
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

MESSAGE="$VERSION ($COMMIT)"
if [ "$1" = "--go" ]; then
  npx wrangler deploy --message "$MESSAGE"
  echo "deployed nabu.run $MESSAGE" >&2
else
  # Uploaded but not live; wrangler prints the version's preview URL.
  npx wrangler versions upload --message "$MESSAGE"
  echo "(preview only; re-run with --go to deploy $VERSION)" >&2
fi
