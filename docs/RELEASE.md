# Release from macOS Terminal

Install GitHub CLI using `brew install gh` and sign in using `gh auth login`.

Clone this repository once:

```sh
git clone https://github.com/TimoM84/8star-grocery-list.git
cd 8star-grocery-list
```

After the v1.1.0 pull request has been reviewed, merged and its CI is green:

```sh
git fetch origin
git switch claude/8star-grocery-list-v1-ks9kyj
git pull --ff-only
bash scripts/release.sh v1.1.0
```

The script validates the package version, clean worktree, absence of an existing tag and the latest successful CI for the exact commit, then creates a GitHub Release (with tag) using GitHub CLI. Do **not** execute before merging the completed update. Do not use `gh pr merge` blindly or create a release from the feature branch.

Docker/Dockhand deployment is separate: after the release, pull/redeploy the configured Git branch in Dockhand. Preserve the `8star-grocery-data` volume and take a backup before schema upgrades.
