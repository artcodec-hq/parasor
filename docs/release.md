# Release Process

Parasor uses `dev` for beta validation and `main` for stable releases.

## Branches

- `main` is the stable branch. Only merge release-ready changes here.
- `dev` is the beta branch. Feature and fix PRs that need beta validation should target `dev`.
- Release tags are the source of published npm packages and GitHub Releases.

If `dev` does not exist on the remote yet, create it from the current `main`
tip before retargeting beta PRs.

## Beta Release

1. Merge beta-bound feature PRs into `dev`.
2. Run the `release` workflow manually with `dry_run=true` on the exact `dev`
   commit you plan to tag.
3. Tag the validated `dev` commit with a prerelease version, for example
   `v0.1.3-beta.1`.
4. Push the tag.

Prerelease tags must point to a commit contained in `origin/dev`. The release
workflow publishes prerelease versions with the prerelease npm dist-tag. For
`v0.1.3-beta.1`, the package is published with `--tag beta` and the GitHub
Release is marked as a prerelease.

## Stable Release

1. Open a release PR from `dev` to `main`.
2. Review and merge the release PR after checks pass.
3. Run the `release` workflow manually with `dry_run=true` on the exact `main`
   commit you plan to tag.
4. Tag the validated `main` commit with a stable version, for example `v0.1.3`.
5. Push the tag.

Stable tags must point to a commit contained in `origin/main`. The release
workflow publishes stable versions with the `latest` npm dist-tag and creates a
normal GitHub Release.

## PR Targets

- Use `dev` as the default base for regular feature and fix PRs.
- Use `main` only for urgent stable fixes or release PRs from `dev`.
- Keep related beta changes merged to `dev` in dependency order, then promote
  through a single `dev` to `main` release PR.
