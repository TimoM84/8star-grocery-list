#!/usr/bin/env bash
# Run on your Mac after v1.1.0 is merged and GitHub CI succeeds.
set -euo pipefail
VERSION="${1:-v1.1.0}"
BASE="claude/8star-grocery-list-v1-ks9kyj"
REPO="TimoM84/8star-grocery-list"
command -v gh >/dev/null || { echo "Install GitHub CLI: brew install gh"; exit 1; }
command -v git >/dev/null || { echo "git is required"; exit 1; }
gh auth status >/dev/null
git fetch origin
git switch "$BASE"
git pull --ff-only origin "$BASE"
test -z "$(git status --porcelain)" || { echo "Working tree must be clean"; exit 1; }
CURRENT_VERSION=$(node -p "require('./package.json').version")
test "$VERSION" = "v$CURRENT_VERSION" || { echo "Version mismatch: package.json=$CURRENT_VERSION requested=$VERSION"; exit 1; }
git show-ref --quiet --tags "refs/tags/$VERSION" && { echo "Tag already exists: $VERSION"; exit 1; }
CI=$(gh run list --repo "$REPO" --branch "$BASE" --limit 1 --json headSha,conclusion --jq '.[0] | [.headSha,.conclusion] | @tsv')
read -r CI_SHA CI_STATE <<< "$CI"
HEAD=$(git rev-parse HEAD)
test "$CI_SHA" = "$HEAD" && test "$CI_STATE" = "success" || { echo "Latest CI is not successful for HEAD"; exit 1; }
echo "Publishing $VERSION from $HEAD"
gh release create "$VERSION" --repo "$REPO" --target "$HEAD" --title "8star Grocery List $VERSION" --generate-notes
echo "Release ready: https://github.com/$REPO/releases/tag/$VERSION"
