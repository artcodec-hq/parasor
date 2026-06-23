# AGENTS.md

Stack: TypeScript, React, Vite, Hono, Vitest, Biome, pnpm

Scope: public `parasor` application repository.

## Branch Workflow

- GitHub's default branch remains `main` for stable public-facing repository
  presentation.
- `dev` is the default development base. Start ordinary feature, fix, refactor,
  and documentation work from `dev`.
- Do not implement ordinary work directly on `main`.
- If the current branch is `main`, create or switch to a task branch based on
  `origin/dev` before editing files.
- Open ordinary PRs against `dev`.
- Use `main` only for release PRs from `dev` or urgent stable hotfixes.
- Stable releases happen only after merging `dev` into `main` through a release
  PR.
- Prerelease tags must point to commits contained in `origin/dev`.
- Stable tags must point to commits contained in `origin/main`.

Rules:

- Treat this repository as the public application repository.
- Keep product source, package metadata, release/deployment docs, security
  docs, license files, and maintainer-facing architecture docs that are needed
  to build, run, review, or secure the app.
- Keep repository `docs/` for durable public documentation that should remain
  versioned with the project.
- Put temporary or development-only investigation notes under `/tmp`, ignored
  `tmp/`, or another explicit temporary location outside tracked docs.
- Do not add private planning or operational notes to this repository.
- Keep changes minimal and reversible. Prefer existing implementation patterns
  before introducing new abstractions.
- Never weaken authentication, authorization, validation, secret handling,
  sandboxing, file access controls, or production safeguards to make release
  packaging easier.
- When creating issues, write them in English by default and include both
  implementation details and clear acceptance criteria.
- Before review, run the relevant package checks. At minimum, run lint,
  focused tests, build, and package verification for release-facing changes.
