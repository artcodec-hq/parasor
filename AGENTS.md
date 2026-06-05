# AGENTS.md

Stack: TypeScript, React, Vite, Hono, Vitest, Biome, pnpm

Scope: public `parasor` application repository.

Rules:

- Treat this repository as the public application repository.
- Keep product source, package metadata, release/deployment docs, security
  docs, license files, and maintainer-facing architecture docs that are needed
  to build, run, review, or secure the app.
- Do not add private planning or operational notes to this repository.
- Keep changes minimal and reversible. Prefer existing implementation patterns
  before introducing new abstractions.
- Never weaken authentication, authorization, validation, secret handling,
  sandboxing, file access controls, or production safeguards to make release
  packaging easier.
- Before review, run the relevant package checks. At minimum, run lint,
  focused tests, build, and package verification for release-facing changes.
