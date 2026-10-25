#!/usr/bin/env bash
# Publish an official GitHub release of 8star Grocery List (macOS, Linux or GitHub Actions).
#
#   bash scripts/release.sh v1.4.0             # checks everything, asks for confirmation, publishes
#   bash scripts/release.sh v1.4.0 --dry-run   # only runs the checks
#
# The Release workflow (.github/workflows/release.yml) runs the same script with
#   --yes                    no typed confirmation (starting the workflow with the version is it)
#   --wait-for-ci MINUTES    wait until GitHub Actions finished for the commit instead of
#                            refusing while it still runs
# and IGNORE_CHECK set to its own job name, so the release job doesn't wait for itself.
#
# Requirements: git, GitHub CLI (`gh auth login` done, or GH_TOKEN set). Run it from a clean
# checkout of the release branch (the repository's default branch unless RELEASE_BRANCH is set),
# after the release pull request is merged and GitHub Actions passed for that exact commit.
# It never switches branches, never pushes commits and never overwrites a tag or release.
# Compatible with the bash 3.2 that ships with macOS.
set -euo pipefail

fail() {
	printf '✗ %s\n' "$*" >&2
	exit 1
}
ok() { printf '✓ %s\n' "$*"; }

usage() {
	echo "Usage: bash scripts/release.sh vMAJOR.MINOR.PATCH [--dry-run] [--yes] [--wait-for-ci MINUTES]" >&2
	exit 2
}

VERSION=""
DRY_RUN=0
ASSUME_YES=0
WAIT_MINUTES=0
while [ $# -gt 0 ]; do
	case "$1" in
		--dry-run) DRY_RUN=1 ;;
		--yes) ASSUME_YES=1 ;;
		--wait-for-ci)
			[ $# -ge 2 ] || usage
			WAIT_MINUTES="$2"
			shift
			;;
		-*) usage ;;
		*)
			[ -z "$VERSION" ] || usage
			VERSION="$1"
			;;
	esac
	shift
done
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
[[ "$WAIT_MINUTES" =~ ^[0-9]+$ ]] || usage
PLAIN="${VERSION#v}"
POLL_SECONDS="${CI_POLL_SECONDS:-30}"
IGNORE_CHECK="${IGNORE_CHECK:-}"

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
	fail "Local $BRANCH ($HEAD_SHA) differs from origin/$BRANCH ($REMOTE_SHA). Run: git pull --ff-only (in the Release workflow: start it again)"
ok "Clean checkout at $HEAD_SHA (same as origin/$BRANCH)"

json_version() {
	sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}
PKG_VERSION="$(json_version package.json)"
[ "$PKG_VERSION" = "$PLAIN" ] || fail "package.json has version $PKG_VERSION, not $PLAIN."
LOCK_VERSION="$(json_version package-lock.json)"
[ "$LOCK_VERSION" = "$PLAIN" ] || fail "package-lock.json has version $LOCK_VERSION, not $PLAIN (run npm install)."
ok "package.json and package-lock.json are at $PLAIN"

# Every other place that names the version must agree, so a release never ships a stale default.
for f in Dockerfile compose.yaml .env.example; do
	[ -f "$f" ] || continue
	STALE="$(grep -nE 'APP_VERSION[^0-9]*[0-9]+\.[0-9]+\.[0-9]+' "$f" | grep -vF "$PLAIN" || true)"
	[ -z "$STALE" ] || fail "$f still names another version:
$STALE"
done
ok "Dockerfile, compose.yaml and .env.example name $PLAIN"

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

# Prints one line per check run and returns 0 (all passed), 1 (one failed) or 2 (still running,
# or none yet). The release job's own check run (IGNORE_CHECK) is left out.
check_ci() {
	local checks name status conclusion pending=0 failed=0 seen=0
	checks="$(gh api "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100" \
		--jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv')" ||
		fail "Could not read GitHub Actions results for $HEAD_SHA."
	while IFS="$(printf '\t')" read -r name status conclusion; do
		[ -n "$name" ] || continue
		[ "$name" != "$IGNORE_CHECK" ] || continue
		seen=1
		if [ "$status" != "completed" ]; then
			printf '  … %s is still %s\n' "$name" "$status"
			pending=1
		elif [ "$conclusion" = "success" ] || [ "$conclusion" = "skipped" ] || [ "$conclusion" = "neutral" ]; then
			printf '  ✓ %s\n' "$name"
		else
			printf '  ✗ %s: %s\n' "$name" "$conclusion"
			failed=1
		fi
	done <<EOF
$checks
EOF
	[ "$failed" -eq 0 ] || return 1
	CI_SEEN="$seen"
	if [ "$seen" -eq 0 ]; then
		echo "  (no GitHub Actions checks for this commit yet)"
		return 2
	fi
	[ "$pending" -eq 0 ] || return 2
	return 0
}

CI_SEEN=0
DEADLINE=$(($(date +%s) + ${CI_WAIT_SECONDS:-$((WAIT_MINUTES * 60))}))
while :; do
	CI_STATE=0
	check_ci || CI_STATE=$?
	[ "$CI_STATE" -ne 1 ] || fail "GitHub Actions must have passed for $HEAD_SHA before releasing."
	[ "$CI_STATE" -ne 0 ] || break
	if [ "$WAIT_MINUTES" -eq 0 ]; then
		[ "$CI_SEEN" -eq 1 ] || fail "No GitHub Actions checks found for $HEAD_SHA. Wait for CI to run."
		fail "GitHub Actions must have passed for $HEAD_SHA before releasing (still running)."
	fi
	[ "$(date +%s)" -lt "$DEADLINE" ] ||
		fail "GitHub Actions did not finish for $HEAD_SHA within $WAIT_MINUTES minutes; nothing was released."
	echo "  Waiting ${POLL_SECONDS}s for GitHub Actions…"
	sleep "$POLL_SECONDS"
done
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

if [ "$ASSUME_YES" -eq 1 ]; then
	ok "Confirmed with --yes"
else
	printf 'Type %s to create the tag and publish the release: ' "$VERSION"
	read -r ANSWER || ANSWER=""
	[ "$ANSWER" = "$VERSION" ] || fail "Not confirmed; nothing was changed."
fi

git tag -a "$VERSION" -m "8star Grocery List $VERSION" "$HEAD_SHA"
# A plain push never overwrites: it is refused if the tag appeared on GitHub in the meantime.
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
echo "Next: set APP_VERSION=$PLAIN in Dockhand and choose Pull & redeploy (see docs/RELEASE.md)."
echo "The release itself changes nothing on your server."
