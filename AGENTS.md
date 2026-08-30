# JobSeeker Agent Repository Guide

This file applies to the entire repository. A nested `AGENTS.md` would win for its subtree without weakening root safety, secrets, or verification rules.

## Purpose

JobSeeker Agent is a local-first, evidence-grounded job-search agent built with Next.js App Router, TypeScript, React, and `next-intl`.

## Start Here

1. Read the user request and the relevant source, tests, or docs in full.
2. Inspect `git status --short` and preserve unrelated or user-authored changes.
3. Prefer current implementation + colocated tests as source of truth; use `README.md` and `docs/deployment.md` for product/ops boundaries; treat `docs/superpowers/` as design history.
4. Choose the smallest change that fully solves the request.
5. **Do not** commit, amend, tag, push, publish, or deploy unless the user explicitly asks.

## Project Intent

Preserve these product invariants:

- Career evidence is the boundary for real resume claims. Missing evidence becomes a question or an explicit gap, never an invented achievement.
- AI output is a proposal, not authority. Validate model output deterministically and require the existing approval steps before applying it.
- Never silently rewrite the master resume. Accepted optimization changes create or update a separate job-specific `ResumeVariant` unless the user explicitly requests a different product change.
- Sample and AI-generated sandbox resumes are not verified career evidence. Only trusted upload, paste, or explicitly reviewed bounded BOSS-resume imports may enter the evidence workspace under the existing rules.
- Durable user data belongs to the browser origin. Do not add server-side persistence, accounts, analytics, cloud sync, or uploaded-file retention without an explicit product decision.
- Cloud use must remain explicit. Automatic mode may fall back to a cloud provider only when the saved preference allows it; do not introduce silent fallback.
- API keys and career data must not be logged, echoed, or persisted by server routes.
- Job discovery uses dedicated adapters for reviewed public sources. The local Browser Agent may operate visible, already-authenticated platform UI through reviewed per-platform adapters, but must never export or replay cookies, accept arbitrary target URLs, bypass login/2FA/CAPTCHA, scrape private marketplace data in bulk, or become an unattended application submitter. A message send requires deterministic recipient and final-content checks plus a platform success receipt.
- Opening an employer application page is not proof of submission. Only an explicit user confirmation may move a local application record to `applied` and set `submittedAt`.

## Repository Map

- `app/[locale]/`: locale-aware App Router pages. Most pages are route descriptors that open an application in the shared shell.
- `app/api/`: stateless same-origin route handlers for AI calls and document extraction.
- `components/desktop/`: desktop/mobile shell, application registry integration, window management, Dock, and global UI providers.
- `components/apps/`: product applications such as Studio, JD Match, Agent, Settings, and resume presentation views.
- `components/apps/use-application-controller.ts`: application packet, explicit submission, and local note actions.
- `components/apps/use-boss-conversation-controller.ts`: BOSS recipient verification, send/receipt, resume-request, reply, and follow-up orchestration.
- `components/apps/use-job-search-profile-controller.ts`: search configuration, resume-derived defaults, goal parsing, and profile persistence.
- `components/apps/use-job-discovery-controller.ts`: BOSS/public discovery, scoring, candidate queue, manual import, and Target Job handoff.
- `components/resume-draft-provider.tsx`: active resume and draft context.
- `lib/resume-model.ts`: canonical `ResumeData`, drafts, snapshots, IDs, and normalization.
- `lib/resume-store.ts`: localStorage draft persistence and multi-tab merge behavior.
- `lib/agent/`: evidence domain, IndexedDB store, provider routing, deterministic scoring, optimization state machine, plans, change sets, and variants.
- `lib/jobs/`: authorized public-source adapters, local posting/recommendation/application contracts, refresh, scoring, promotion, and packet state transitions.
- `lib/jobs/job-workspace.ts`: indexed active-draft workspace loading and automatic packet/conversation refresh.
- `lib/jobs/job-scoring.ts`: shared deterministic rescoring for the current search profile and trusted draft.
- `lib/jobs/job-strategy-memory.ts`: bounded, versioned, independently managed history-learning strategy memory.
- `lib/server/`: request guards, bounded JSON parsing, document parser isolation, and DOCX preflight checks.
- `i18n/` and `messages/`: locale routing and Chinese/English messages.
- `tests/e2e/`: Playwright desktop, mobile, safety, and workflow coverage.
- `docs/`: deployment boundaries, design specifications, and implementation plans.

## Sources Of Truth

- Treat the current implementation and its colocated tests as the source of truth for behavior and invariants.
- Use `README.md` for the current product model and local workflow, and `docs/deployment.md` for environment, security, release, retry, rollback, and production boundaries.
- Treat dated files under `docs/superpowers/` as design history. Verify their assumptions against current code, tests, README, and deployment documentation before using them as requirements.
- When behavior, data boundaries, or operational behavior changes intentionally, update the authoritative documentation in the same change instead of leaving contradictory guidance.

## Architecture Rules

- Keep `ResumeData` as the normalized contract consumed by every presentation application. Do not make a view depend on raw uploaded files or model-specific output.
- Keep desktop layout state independent from resume and Agent domain state. Closing or resetting a window must not delete career data.
- Use the existing persistence boundaries:
  - localStorage for drafts, snapshots, desktop state, provider preferences, theme, motion, the active workflow pointer, and versioned strategy memory.
  - IndexedDB through `lib/agent/domain-store.ts` for evidence sources, career facts, public job data, recommendations, application records, target jobs, requirements, matches, variants, and optimization runs.
  - sessionStorage for a BYOK key by default; localStorage only after explicit remember consent.
- Treat data from requests, storage, uploaded documents, and models as untrusted. Parse it through the relevant Zod schema and retain existing byte/count limits.
- Preserve IndexedDB referential integrity. Writes involving related Agent entities must use the domain-store transaction API.
- Keep optimization transitions inside the deterministic state machine. Do not mutate `OptimizationRun.stage` ad hoc in components.
- Keep alignment and structure scores deterministic. Never accept a model-authored score or pass probability.
- Apply resume changes only through the change-set validators and applicator. Preserve protected fields, original-value checks, approved-plan references, evidence checks, and stale-input fingerprints.
- Treat persisted schemas as public local data contracts. Schema changes require backward-compatible parsing or an explicit migration plus tests using older stored data; never solve a migration by silently clearing browser storage.
- Uploaded PDF, DOCX, and TXT bytes are transient extraction inputs. Do not persist the original files or add them to the evidence store without an explicit product and privacy decision.
- Propagate cancellation through browser requests, provider calls, document parsing, and long-running work. Ignore late responses after cancellation or input changes, and retain fingerprint-based stale-result protection.
- Browser cloud requests must use `aiFetch` and its approved same-origin paths. Document extraction and the bounded `/api/jobs/discover` public-source route are the deliberate same-origin non-AI exceptions.
- Browser-platform automation must stay in the bundled local extension. The web app communicates through the versioned, bounded bridge protocol; platform content, cookies, credentials, and raw private inbox data must not be exposed to page scripts or server routes.
- Preserve request-guard, provider-host allowlist, no-redirect, timeout, rate-limit, payload-limit, and worker-resource boundaries when changing API routes.
- Avoid adding a vector database or embedding pipeline unless the product scope explicitly changes. Retrieval currently means typed, explicit evidence references.

## UI And Localization

- Reuse the application registry and `AppLoader` for desktop and mobile application entry points. A new application normally requires registry metadata, loading integration, route mapping, and messages.
- Keep desktop URLs synchronized with the focused application and retain mobile full-screen routing behavior.
- Add user-facing text to both `messages/en.json` and `messages/zh.json`; do not hard-code production UI copy in components.
- Respect theme, motion preference, reduced-motion behavior, keyboard access, focus states, ARIA labels, and mobile safe areas.
- Lazy-load browser-only or heavy visual features where appropriate; preserve the existing WebGL fallback behavior.
- Prefer extracting controller hooks and application services when a component starts mixing substantial UI, networking, persistence, and workflow logic.

## Coding Conventions

- Use strict TypeScript and the `@/` path alias. Avoid `any`; use `unknown` plus validation at boundaries.
- Keep domain logic pure and deterministic where possible. Inject stores, clocks, and external runners when that improves testability.
- Use server-only Node APIs only in server modules or Node route handlers. Add `'use client'` only where browser state, effects, or browser APIs require it.
- Preserve stable IDs and input fingerprints across persisted relations. Do not use array position as a durable domain identity.
- Keep changes focused. Do not perform unrelated formatting, dependency upgrades, architectural rewrites, or generated snapshot updates.
- Preserve existing user changes in a dirty worktree. Inspect before editing and do not revert files you did not change.
- Never commit secrets, `.env.local`, provider keys, uploaded resumes, generated career data, or test artifacts containing personal information.

## Runtime And Environment

- Use Node.js 24.18.0 (`>=24.18.0 <25`) and `pnpm@11.17.0`. Do not use npm or Yarn to install dependencies or generate another lockfile.
- The default development server is local-only at `127.0.0.1:3001`. If that port is occupied, use another loopback port; do not terminate an unrelated process merely to reclaim the default port.
- Keep secrets in untracked `.env.local` or the deployment secret store. `.env.example` must contain only safe placeholders, and server credentials must never be exposed through a `NEXT_PUBLIC_*` variable or client bundle.
- Treat `JOB_SEEKER_AGENT_ALLOWED_AI_HOSTS`, `JOB_SEEKER_AGENT_AI_ACCESS_TOKEN`, `JOB_SEEKER_AGENT_LOCAL_ONLY`, and `JOB_SEEKER_AGENT_TRUSTED_PROXY` as security-boundary configuration. Do not weaken their semantics to make a request work.
- When adding or changing an environment variable, update `.env.example`, `README.md`, and `docs/deployment.md` wherever that variable affects local or production operation.

## Dependencies And Generated Artifacts

- Prefer existing platform APIs and installed libraries. Add a dependency only when it materially reduces risk or complexity, and consider client bundle size, server runtime compatibility, and document-worker tracing.
- Use pnpm for dependency changes and commit `package.json` and `pnpm-lock.yaml` together. Do not hand-edit the lockfile.
- Changes to `serverExternalPackages`, document parser dependencies, worker assets, or `outputFileTracingIncludes` require the production extraction smoke test.
- Do not stage ignored build or local-state output such as `.next/`, `out/`, `.vercel/`, `.worktrees/`, or local environment files.
- In normal feature and fix work, do not pre-bump `package.json`, hand-maintain `CHANGELOG.md`, or create version tags. Release artifacts are created only when the user explicitly requests a release.

## Commands And Verification

Use the pinned package manager:

```bash
corepack pnpm@11.17.0 install
corepack pnpm@11.17.0 dev
corepack pnpm@11.17.0 check   # authoritative: typecheck + tests + build
```

Primary checks:

```bash
corepack pnpm@11.17.0 typecheck
corepack pnpm@11.17.0 test
corepack pnpm@11.17.0 build
corepack pnpm@11.17.0 test:e2e
corepack pnpm@11.17.0 test:production-extraction
```

Verification policy:

- Run the narrowest relevant Vitest file while iterating.
- Keep unit and component tests colocated as `*.test.ts` or `*.test.tsx`; keep browser workflows in `tests/e2e/`. Add a regression test for a bug fix when the failure is reproducible.
- Use synthetic resume and provider data in tests, fixtures, screenshots, and logs. Never copy a real resume, API key, or personal career history into the repository.
- Before handing off a material code change, run the authoritative `pnpm check`
  (`typecheck` + full unit/integration suite + production build).
- Run `build` for App Router, server/client boundary, configuration, dependency, or production-bundling changes.
- Run `test:production-extraction` for document parsing, worker, dependency tracing, Next config, or deployment changes.
- Run the relevant Playwright project for desktop/mobile routing, window management, responsive UI, or complete user-flow changes. **E2E is not part of `pnpm check`.**
- Security-boundary changes require both an allowed-path test and a rejected-path test. Cover origins, provider hosts, redirects, limits, credential handling, and cancellation as applicable.
- Do not run `test:e2e:update` or update snapshots merely to make a failing test pass. Snapshot changes must be intentional, inspected, and explained.
- For documentation-only changes, at minimum run `git diff --check` and verify every referenced path, command, environment variable, and workflow against the repository.
- If a required check cannot run, report exactly which check was skipped and why.

## Git And Commit Messages

Do not commit, amend, tag, or push unless the user explicitly asks for that action.

The repository does not install or ship Git hooks. Its read-only Quality
workflow runs `pnpm check` and the complete Playwright suite for pull requests
and pushes to `main`, but run the checks required by this guide directly before
committing or pushing instead of relying only on remote CI.

When asked to commit or use Commit and Push:

1. Inspect `git status`, the unstaged diff, and the staged diff.
2. Stage only files that belong to the requested change. Do not use `git add .` or `git add -A` without first verifying the complete scope.
3. Run checks proportional to the change before committing.
4. Generate the commit subject from the staged diff, not merely from the task description.
5. Use exactly one focused Conventional Commit subject in English:

```text
<type>(<scope>): <imperative summary>
```

Rules:

- Allowed types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Use `feat`, never `feature`.
- Use a lowercase type and optional lowercase scope. Useful scopes include `agent`, `studio`, `desktop`, `api`, `i18n`, `settings`, `docs`, `test`, `deps`, and `release`.
- Keep the subject imperative, free of a trailing period, and at most 100 characters.
- Use `!` for a breaking change, for example `feat(agent)!: replace persisted run schema`, and explain the migration in a `BREAKING CHANGE:` footer when useful.
- Split unrelated changes into separate commits when they have independent purposes or release effects.
- Do not amend an existing commit or force-push unless explicitly requested.

Examples:

```text
fix(agent): reject stale resume changes
feat(studio): add resume export
docs(deployment): clarify browser data boundaries
test(desktop): cover restored window focus
```

Release behavior:

- Releases are not started automatically. Preparing a version commit and
  publishing its main revision both require an explicit release request.
- `fix`, `perf`, and `revert` create a patch release.
- `feat` creates a minor release.
- A breaking-change note creates a major release.
- `docs`, `refactor`, `test`, `build`, `ci`, and `chore` do not create a release by themselves.
- When a release is explicitly requested, start from a clean, up-to-date `main`,
  run `pnpm check`, and let release-it create only the version and changelog
  commit. It must not tag, publish, or push automatically.
- Push the generated `chore(release): vX.Y.Z` commit directly to `main`, then
  invoke the manual Release workflow from the `main` ref with the tag and full
  release commit SHA. The workflow resolves remote tag and
  Release state immediately before publication, verifies the resulting stable
  Release, and repeats that verification before deployment secrets are exposed.
- Keep `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` on the
  `production` GitHub Environment. Restrict that Environment to the `main`
  branch so other refs cannot access production credentials.
- Do not run `pnpm release`, deploy production, move a tag, or invoke the manual
  Release workflow unless the user explicitly requests that exact release
  operation.

## Review Guidelines

When reviewing a change, prioritize actionable correctness, data-loss, privacy, security, and regression risks over style preferences. Inspect the changed behavior and its callers rather than reviewing only the visible diff in isolation.

Specifically check for:

- Resume claims that are not backed by saved evidence, AI output that bypasses deterministic validation, or changes that mutate the master resume without explicit approval.
- Browser-storage schema changes that lose older data, break IndexedDB references, resurrect deleted multi-tab state, or leave active workflows inconsistent.
- Secret or career-data leakage through logs, errors, client bundles, persistence, fixtures, analytics, redirects, or overly broad cloud request payloads.
- SSRF, cross-origin, provider-redirect, trusted-proxy, shared-key, rate-limit, payload-limit, parser-resource, and access-token regressions in API or deployment changes.
- Silent provider fallback, missing cancellation, stale asynchronous results, races between requests, and model-authored values being trusted as deterministic facts or scores.
- Missing `en`/`zh` copy, keyboard or focus regressions, reduced-motion violations, broken desktop/mobile routing, and missing loading or error states.
- Tests that only exercise the happy path, snapshots updated without explanation, or production/release assumptions that no longer match the workflows.

Review findings must identify a concrete failure scenario and its user or operational impact, with the narrowest relevant file and line. Do not report speculative preferences as defects; if no actionable findings remain, say so and mention any verification gap.

## Definition Of Done

A change is complete only when:

- The requested behavior is implemented without violating the product invariants above.
- Relevant boundary validation, error handling, cancellation, and stale-result protection remain intact.
- Tests cover the changed behavior at the appropriate domain, component, route, or E2E level.
- Required checks pass, or skipped checks are disclosed with a reason.
- Both locales and accessibility behavior are updated when UI behavior changes.
- README or deployment documentation is updated when data, privacy, provider, release, or operational boundaries change.
- The final summary lists the changed files, verification performed, and any remaining risk or follow-up.
