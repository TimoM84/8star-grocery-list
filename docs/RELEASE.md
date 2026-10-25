# Publishing and deploying a release

A release is an annotated Git tag (`v1.4.0`) on the default branch plus a GitHub Release with
the notes from `CHANGELOG.md`. Publishing never deploys anything; Dockhand only changes when you
change `APP_VERSION` there.

## In short

1. **Merge the release pull request** (it carries the new version in `package.json`,
   `package-lock.json`, `Dockerfile`, `compose.yaml`, `.env.example` and a `## X.Y.Z` section in
   `CHANGELOG.md`).
2. **GitHub → Actions → Release → Run workflow**, branch = the default branch, type the version
   (e.g. `1.4.0`) → **Run workflow**. It waits for CI on that commit (up to 60 minutes) and then
   publishes. The run summary links the release.
3. **Dockhand → stack `8star-grocery` → stack variables → `APP_VERSION` = `1.4.0`** (without `v`).
4. **Pull & redeploy.** Check `http://192.168.2.229:3008/api/health` shows the new `version`.

## What the Release workflow checks

`.github/workflows/release.yml` runs `scripts/release.sh vX.Y.Z --yes --wait-for-ci 60`, the same
checks as the terminal script, without a typed confirmation (starting the workflow with the
version is the confirmation). It stops, without creating anything, when:

- it was started from another branch than the default branch, or the default branch moved on
  after you started it (start it again);
- the version isn't `X.Y.Z`, or `package.json`, `package-lock.json`, `Dockerfile`,
  `compose.yaml` or `.env.example` name another version, or `CHANGELOG.md` has no `## X.Y.Z`
  section;
- the tag or a GitHub Release with that name already exists (nothing is ever overwritten; a
  second run waits for the first one);
- any CI check of that exact commit failed, or CI didn't finish within 60 minutes.

Only then does it create the annotated tag on that commit, push it and create the release with
`gh release create --verify-tag`. It uses the workflow's own `GITHUB_TOKEN` with
`contents: write` and `checks: read`; no personal token is involved.

## From the terminal (alternative)

The same script also runs on your Mac and asks you to type the version before publishing.

### One-time setup

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

### Release

```sh
cd 8star-grocery-list
git switch claude/8star-grocery-list-v1-ks9kyj
git pull --ff-only

bash scripts/release.sh v1.4.0 --dry-run   # all checks, changes nothing
bash scripts/release.sh v1.4.0             # same checks, then asks you to type v1.4.0
```

The script stops with a clear message if any of these is not true:

- you are on the release branch, the working tree is clean, and your checkout equals `origin`;
- the version is `vX.Y.Z` and matches `package.json`, `package-lock.json`, `Dockerfile`,
  `compose.yaml` and `.env.example`;
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

1. In Dockhand, open the `8star-grocery` stack and set the variable `APP_VERSION` to the new
   version (e.g. `1.4.0`). The stack's Compose
   ([`deploy/dockhand-compose.yaml`](../deploy/dockhand-compose.yaml)) uses that one variable for
   the Git tag it builds (`v1.4.0`), the image tag and the build argument.
2. **Pull & redeploy.** Dockhand builds the tagged source and recreates the container; the
   `8star-grocery-data` volume is kept. A version without a release fails the build
   (`repository does not contain ref v…`) and the running app stays untouched.
3. Check `http://<server>:<port>/api/health`. It shows the new `version` and `schemaVersion`.

Rolling back is the same in reverse: set `APP_VERSION` to the previous version and redeploy,
following DOCKHAND.md §7 when the database schema changed.

See [DOCKHAND.md §7](DOCKHAND.md#7-updating-eg-v100--v110) for what happens during an update,
the automatic pre-migration backup, and how to roll back.
