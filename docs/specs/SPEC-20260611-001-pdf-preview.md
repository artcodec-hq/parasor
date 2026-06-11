# SPEC-20260611-001: Fix PDF file previews

Status: Done
Created: 2026-06-11
Related: issue#9

> Subsystem decomposition check (mandatory before filling): single coordinated
> change across the file raw media route and file preview surface.

---

## Part 1 — Plan

### Summary

Make PDF previews render through the browser-native PDF viewer when available, while keeping server-side PDF validation and safe fallback states intact.

### Background

Issue #9 asks for first-class PDF previews in the Files pane. The repository already classifies PDFs as previewable media and serves verified PDFs from `/api/files/raw`, but local probing showed the current `iframe sandbox=""` PDF surface fails in Chromium with the browser PDF viewer showing an error icon. MDN documents that empty iframe sandbox applies all restrictions, and iframe error events are not reliable because browsers fire `load` even on failed iframe loads. Considered alternatives:

- Keep `sandbox=""`: rejected because it breaks browser-native PDF viewing.
- Switch to `<object>` or `<embed>`: rejected because these legacy elements do not have iframe-style sandbox controls and are better restricted by CSP.
- Add PDF.js immediately: rejected for the initial fix because the issue asks for browser-native viewing where available, and PDF.js adds dependency and bundle complexity that is only needed as a later fallback if native viewers are insufficient.

### Requirements

1. Selecting a `.pdf` file opens a read-only in-app preview rather than the text editor.
2. Raw PDF serving must continue to validate path containment, size limits, extension, and magic number before streaming.
3. Native PDF preview must not use iframe sandbox settings that block the browser PDF viewer.
4. Browsers without inline PDF support must get a clear fallback/error state.
5. Tests must cover server PDF serving/validation and web PDF preview behavior.

### Acceptance Criteria

- [x] AC-1: Selecting a `.pdf` file routes to a PDF preview surface.
- [x] AC-2: Verified PDFs from `/api/files/raw` return `application/pdf`, inline disposition, byte ranges, and hardened headers.
- [x] AC-3: Non-PDF bytes renamed to `.pdf` are rejected server-side.
- [x] AC-4: PDF preview does not use a strict empty iframe sandbox that prevents Chromium's native PDF viewer.
- [x] AC-5: Browsers without inline PDF viewing support show a clear fallback/error state instead of an unusable iframe.
- [x] AC-6: Existing large file gate and worktree path threading remain intact.

### Tasks

- [x] T-1
  - scope: `packages/server/src/routes/files.ts`
  - action: Adjust PDF raw response headers to keep inline verified PDF serving while avoiding a response-level sandbox that blocks native PDF viewers; keep SVG strict CSP unchanged.
  - verify: `packages/server/src/routes/files.test.ts` PDF header tests
  - covers: AC-2, AC-6
- [x] T-2
  - scope: `packages/server/src/routes/files.test.ts`
  - action: Add real filesystem tests for verified PDF serving and renamed non-PDF rejection.
  - verify: focused server vitest
  - covers: AC-2, AC-3
- [x] T-3
  - scope: `packages/web/src/features/panes/editor/MediaPreviewPane.tsx`
  - action: Replace strict PDF iframe sandbox with native viewer iframe guarded by `navigator.pdfViewerEnabled`, plus a clear fallback state when inline viewing is unavailable.
  - verify: `MediaPreviewPane.test.tsx`
  - covers: AC-4, AC-5, AC-6
- [x] T-4
  - scope: `packages/web/src/features/panes/editor/MediaPreviewPane.test.tsx`
  - action: Cover PDF iframe URL/worktree behavior, absence of empty sandbox, and unsupported-browser fallback.
  - verify: focused web vitest
  - covers: AC-1, AC-4, AC-5, AC-6

### Verification Mapping

| AC   | Verified by                       | Where                  |
| ---- | --------------------------------- | ---------------------- |
| AC-1 | PDF preview component test        | `MediaPreviewPane.test.tsx` |
| AC-2 | Raw PDF route header test         | `files.test.ts` |
| AC-3 | Fake `.pdf` route rejection test  | `files.test.ts` |
| AC-4 | PDF iframe sandbox regression test | `MediaPreviewPane.test.tsx` |
| AC-5 | Unsupported inline PDF fallback test | `MediaPreviewPane.test.tsx` |
| AC-6 | Existing and added media/worktree/size tests | `MediaPreviewPane.test.tsx`, `files.test.ts` |

### Risks / Assumptions

- ASSUMPTION: Browser-native PDF viewing is acceptable when `navigator.pdfViewerEnabled` reports support — resolution required at: implementation.
- RISK: Removing iframe `sandbox=""` could loosen client-side defense-in-depth — mitigation: keep server-side PDF magic-number validation and add hardened PDF response headers without the sandbox directive.
- RISK: iframe failure cannot be detected reliably — mitigation: use `navigator.pdfViewerEnabled` and raw endpoint status checks rather than iframe `error`.

### Technical Design

The trusted boundary remains the server raw route: it resolves through project/worktree scoping, opens with no symlink following, enforces size limits, sniffs bytes, and streams from the same file handle. The web layer treats PDFs as read-only media and only constructs a raw URL. For PDF display, the browser-native viewer needs a normal nested browsing context, so the iframe must not use the strict empty sandbox. Unsupported browser fallback is driven by `navigator.pdfViewerEnabled`, which is the current browser API for inline PDF support. Response CSP keeps SVG locked down; PDF responses should use non-sandbox hardening headers that do not prevent the native viewer.

---

## Part 2 — Implementation Record

### Decision Log

- 2026-06-11 15:57 | create standard In Progress spec | #9 changes server headers, web preview behavior, and tests across multiple files | lightweight spec rejected because this is not a <3-file mechanical fix
- 2026-06-11 15:57 | implement locally without subagents | available subagent tool permits spawning only when the user explicitly requests delegation; user requested branch and implementation, not delegation | spawning rejected by tool policy
- 2026-06-11 16:04 | keep native PDF preview unsandboxed while hardening the raw response | Chromium's built-in PDF viewer fails under empty iframe/CSP sandbox, while the server route already validates real PDF bytes before inline serving | `<object>`/`<embed>` rejected for weaker controls; immediate PDF.js rejected as unnecessary dependency for initial native-preview scope
- 2026-06-11 16:09 | mark review gate clean | Tech Lead, Product Owner, UX, Code Review, Tester, Security, Performance, Domain, and Contract checks found no blocking issues after focused and full-suite verification | no follow-up implementation tasks accepted
- 2026-06-11 17:33 | encode non-ASCII Content-Disposition fallback | real corptool PDF filenames include Japanese characters; raw route returned 500 because HTTP quoted filename fallback contained non-ASCII header bytes | keeping raw UTF-8 in `filename="..."` rejected; `filename*` keeps the UTF-8 name
- 2026-06-11 17:36 | omit `X-Frame-Options` for PDF raw responses | API-wide `DENY` header blocks Chrome's native PDF viewer inside the app iframe | keeping `DENY` or `SAMEORIGIN` rejected because Chrome PDF rendering uses browser-internal framing; app shell and non-PDF API responses keep `DENY`

### Deviations from Plan

- 2026-06-11 17:33 | added non-ASCII PDF filename route coverage | manual dev check found raw route 500 before iframe rendering
- 2026-06-11 17:36 | updated API frame header handling beyond the original file route plan | manual dev check found API-wide `X-Frame-Options: DENY` on PDF raw responses

### Changed Files

- `packages/server/src/routes/files.ts` — split SVG and PDF response security headers so PDFs avoid CSP sandbox while keeping inline, same-origin, and nosniff hardening; ASCII-sanitize `Content-Disposition` fallback filenames while preserving UTF-8 `filename*`.
- `packages/server/src/bootstrap/create-app-server.ts` — keep API `X-Frame-Options: DENY` for non-PDF responses while omitting it for `application/pdf` raw previews.
- `packages/server/src/routes/files.test.ts` — added verified PDF serving/header coverage, non-ASCII PDF filename coverage, and renamed fake `.pdf` rejection coverage.
- `packages/web/src/features/panes/editor/MediaPreviewPane.tsx` — removed strict PDF iframe sandbox and added `navigator.pdfViewerEnabled === false` fallback.
- `packages/web/src/features/panes/editor/MediaPreviewPane.test.tsx` — updated PDF preview expectations and added worktree/fallback coverage.
- `docs/specs/SPEC-20260611-001-pdf-preview.md` — recorded plan, decisions, changed files, and verification.

### Test Results

- `pnpm --filter @parasor/server exec vitest run src/fs/media.test.ts src/routes/files.test.ts` — pass, 59 tests.
- `pnpm --filter @parasor/server exec vitest run src/routes/files.test.ts src/routes/projects.test.ts` — pass, 95 tests after non-ASCII filename and PDF XFO fixes.
- `pnpm --filter @parasor/web exec vitest run --config vitest.config.ts --project=unit src/features/panes/editor/MediaPreviewPane.test.tsx src/features/panes/editor/EditorPane.test.tsx` — pass, 16 tests.
- `pnpm lint` — pass.
- `pnpm typecheck` — pass.
- `pnpm build` — pass.
- `pnpm test` — pass; server 133 files / 1691 tests and web 117 files / 1083 tests.
- Manual dev check against `http://100.116.46.113:7683/api/files/raw?...output/20260531_株式会社メッツァ_請求書_211200.pdf` — pass; `HEAD` returns 200 and `Range: bytes=0-31` returns 206 `application/pdf` without `X-Frame-Options`.

### Deferred

- (None)
