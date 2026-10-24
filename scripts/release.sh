#!/usr/bin/env bash
# Publish an official GitHub release of 8star Grocery List from your terminal (macOS or Linux).
#
#   bash scripts/release.sh v1.1.0             # checks everything, asks for confirmation, publishes
#   bash scripts/release.sh v1.1.0 --dry-run   # only runs the checks
#
# Requirements: git, GitHub CLI (`gh auth login` done). Run it from a clean checkout of the
# release branch (the repository's default branch unless RELEASE_BRANCH is set), after the
# release pull request is merged and GitHub Actions passed for that exact commit.
# It never switches branches, never pushes commits and never publishes without confirmation.
# Compatible with the bash 3.2 that ships with macOS.
set -euo pipefail

fail() {
	printf '✗ %s\n' "$*" >&2
	exit 1
}
ok() { printf '✓ %s\n' "$*"; }

usage() {
	echo "Usage: bash scripts/release.sh vMAJOR.MINOR.PATCH [--dry-run]" >&2
	exit 2
}

VERSION="${1:-}"
DRY_RUN=0
case "${2:-}" in
	'') ;;
	--dry-run) DRY_RUN=1 ;;
	*) usage ;;
esac
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
PLAIN="${VERSION#v}"

command -v git >/dev/null 2>&1 || fail "git is not installed."
command -v gh >/dev/null 2>&1 || fail "GitHub CLI is not installed: brew install gh"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this inside the repository checkout."
cd "$ROOT"
[ -f package.json ] && [ -f CHANGELOG.md ] || fail "This does not look like the 8star repository."

gh auth status >/dev/null 2>&1 || fail "GitHub CLI is not logged in: gh auth login"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)" || fail "Cannot determine the GitHub repository."
BRANCH="${RELEASE_BRANCH:-$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)}"
[ -n "$BRANCH" ] || fail "Cannot determine the release branch."
ok "Repository $REPO, release branch $BRANCH"

CURRENT="$(git symbolic-ref --quiet --short HEAD || true)"
[ "$CURRENT" = "$BRANCH" ] ||
	fail "You are on '${CURRENT:-detached HEAD}'. Run: git switch $BRANCH && git pull --ff-only"
[ -z "$(git status --porcelain)" ] || fail "Working tree is not clean (commit or stash your changes first)."

git fetch --quiet --tags origin "$BRANCH" || fail "git fetch failed."
HEAD_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"
[ "$HEAD_SHA" = "$REMOTE_SHA" ] ||
	fail "Local $BRANCH ($HEAD_SHA) differs from origin/$BRANCH ($REMOTE_SHA). Run: git pull --ff-only"
ok "Clean checkout at $HEAD_SHA (same as origin/$BRANCH)"

json_version() {
	sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}
PKG_VERSION="$(json_version package.json)"
[ "$PKG_VERSION" = "$PLAIN" ] || fail "package.json has version $PKG_VERSION, not $PLAIN."
LOCK_VERSION="$(json_version package-lock.json)"
[ "$LOCK_VERSION" = "$PLAIN" ] || fail "package-lock.json has version $LOCK_VERSION, not $PLAIN (run npm install)."
ok "package.json and package-lock.json are at $PLAIN"

NOTES="$(mktemp "${TMPDIR:-/tmp}/8star-release-notes.XXXXXX")"
trap 'rm -f "$NOTES"' EXIT
awk -v v="$PLAIN" '
	$0 ~ "^## " v "([[:space:]]|$)" { found = 1; next }
	found && /^## / { exit }
	found { print }
' CHANGELOG.md >"$NOTES"
[ -s "$NOTES" ] && grep -q '[^[:space:]]' "$NOTES" || fail "CHANGELOG.md has no '## $PLAIN' section with release notes."
ok "Release notes found in CHANGELOG.md"

if git ls-remote --exit-code --tags origin "refs/tags/$VERSION" >/dev/null 2>&1; then
	fail "Tag $VERSION already exists on GitHub."
fi
if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
	fail "Tag $VERSION exists locally but not on GitHub. Remove it first: git tag -d $VERSION"
fi
if gh release view "$VERSION" --repo "$REPO" >/dev/null 2>&1; then fail "GitHub release $VERSION already exists."; fi
ok "Tag and release $VERSION do not exist yet"

CHECKS="$(gh api "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100" \
	--jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv')" ||
	fail "Could not read GitHub Actions results for $HEAD_SHA."
[ -n "$CHECKS" ] || fail "No GitHub Actions checks found for $HEAD_SHA. Wait for CI to run."
BAD=0
while IFS="$(printf '\t')" read -r name status conclusion; do
	[ -n "$name" ] || continue
	if [ "$status" != "completed" ]; then
		printf '  … %s is still %s\n' "$name" "$status"
		BAD=1
	elif [ "$conclusion" = "success" ] || [ "$conclusion" = "skipped" ] || [ "$conclusion" = "neutral" ]; then
		printf '  ✓ %s\n' "$name"
	else
		printf '  ✗ %s: %s\n' "$name" "$conclusion"
		BAD=1
	fi
done <<EOF
$CHECKS
EOF
[ "$BAD" -eq 0 ] || fail "GitHub Actions must have passed for $HEAD_SHA before releasing."
ok "All GitHub Actions checks passed for this commit"

echo
echo "Release:  8star Grocery List $VERSION"
echo "Commit:   $HEAD_SHA ($(git log -1 --format=%s HEAD))"
echo "Notes:"
sed 's/^/  | /' "$NOTES"
echo

if [ "$DRY_RUN" -eq 1 ]; then
	ok "Dry run: all checks passed. Nothing was tagged or published."
	exit 0
fi

printf 'Type %s to create the tag and publish the release: ' "$VERSION"
read -r ANSWER || ANSWER=""
[ "$ANSWER" = "$VERSION" ] || fail "Not confirmed; nothing was changed."

git tag -a "$VERSION" -m "8star Grocery List $VERSION" "$HEAD_SHA"
if ! git push origin "refs/tags/$VERSION"; then
	git tag -d "$VERSION" >/dev/null
	fail "Pushing the tag failed; the local tag was removed again."
fi
ok "Annotated tag $VERSION pushed"

if ! gh release create "$VERSION" --repo "$REPO" --verify-tag \
	--title "8star Grocery List $VERSION" --notes-file "$NOTES"; then
	fail "The tag exists but creating the release failed. Retry with:
  gh release create $VERSION --repo $REPO --verify-tag --title \"8star Grocery List $VERSION\" --notes-file <notes>"
fi
ok "Published https://github.com/$REPO/releases/tag/$VERSION"
echo
echo "Next: redeploy the stack in Dockhand (see docs/RELEASE.md). The release itself changes nothing on your server."
