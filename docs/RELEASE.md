# Publishing a release from the macOS terminal

A release is an annotated Git tag (`v1.1.0`) on the release branch plus a GitHub Release with the
notes from `CHANGELOG.md`. Publishing a release does **not** deploy anything; redeploying in
Dockhand is a separate step (below).

The release branch is the repository's **default branch**, currently
`claude/8star-grocery-list-v1-ks9kyj`. The script reads it from GitHub, so it keeps working if
you rename the default branch later. Override it with `RELEASE_BRANCH=<branch>` if needed.

## One-time setup

```sh
# Command line tools (Git) and Homebrew, if you don't have them yet
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# GitHub CLI
brew install gh
gh auth login            # GitHub.com → HTTPS → "Login with a web browser"
gh auth status           # should show your account

# Clone the repository
git clone https://github.com/TimoM84/8star-grocery-list.git
cd 8star-grocery-list
```

## Before releasing

1. The release pull request (e.g. _v1.1.0_) is reviewed and **merged** into the default branch.
2. GitHub Actions is **green for the merge commit** (both jobs: tests and Docker).
3. `package.json`, `package-lock.json` and the top section of `CHANGELOG.md` carry the version.

## Release

```sh
cd 8star-grocery-list
git switch claude/8star-grocery-list-v1-ks9kyj
git pull --ff-only

bash scripts/release.sh v1.1.0 --dry-run   # all checks, changes nothing
bash scripts/release.sh v1.1.0             # same checks, then asks you to type v1.1.0
```

The script stops with a clear message if any of these is not true:

- you are on the release branch, the working tree is clean, and your checkout equals `origin`;
- the version is `vX.Y.Z` and matches `package.json` and `package-lock.json`;
- `CHANGELOG.md` has a `## X.Y.Z` section (it becomes the release notes);
- the tag doesn't exist locally or on GitHub, and no GitHub Release with that name exists;
- **every** GitHub Actions check of that exact commit has completed successfully.

Only after you type the version does it:

1. create the annotated tag `vX.Y.Z` on that commit;
2. push the tag;
3. create the GitHub Release with `gh release create --verify-tag`.

It never switches branches, pushes commits or merges anything. If the tag push fails, the local
tag is removed again. If the release creation fails after the tag was pushed, it prints the
exact `gh release create` command to retry.

## Deploying the release (Dockhand)

Releasing and deploying are deliberately separate:

1. In Dockhand, open the `8star-grocery` stack → **Pull & redeploy**. It builds the image from
   the default branch (now at the release commit) and keeps the `8star-grocery-data` volume.
2. Check `http://<server>:<port>/api/health`. It shows the new `version` and `schemaVersion`.

See [DOCKHAND.md §7](DOCKHAND.md#7-updating-eg-v100--v110) for what happens during an update,
the automatic pre-migration backup, and how to roll back.
