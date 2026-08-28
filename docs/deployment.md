# Deployment and data boundaries

JobSeeker Agent is a local-first Evidence Agent with a stateless Next.js service boundary. “Local-first” means the durable career workspace belongs to the browser origin; it does not mean that every operation is guaranteed to run offline or that uploaded files never reach a same-origin route.

## Runtime responsibilities

| Runtime | Responsibilities | Durable user data |
| --- | --- | --- |
| Browser | Desktop/mobile UI, drafts, Career Evidence, requirement matrix, deterministic scoring, agent-run state, approvals, variants, provider selection | `localStorage` and IndexedDB for this origin |
| Chrome Built-in AI (Beta) | Supported structured tasks through the browser `LanguageModel` API | Model lifecycle is managed by Chrome; JobSeeker Agent does not copy the model into its database |
| Next.js route handlers | Same-origin request validation, bounded Greenhouse/Lever public-job discovery, PDF/DOCX/TXT extraction, OpenAI-compatible request execution, schema/error normalization | None; request-scoped processing only |
| User-configured OpenAI-compatible provider | Cloud inference for explicitly selected cloud tasks | Governed by that provider's policy, not by JobSeeker Agent |

The application has no server-side user database, ORM, account system, authentication session, vector database, or cloud-sync layer. Serverless Function instances may be created or discarded without losing the user's saved workspace because that workspace remains in the browser. Changing domains, subdomains, browser profiles, or site-storage partitions creates a different local workspace.

The JobSeeker Agent rebrand migrates legacy `resume-os*` localStorage values into the new `job-seeker-agent*` keys on first read. The IndexedDB database intentionally retains its original `resume-os-domain` name so existing career evidence, jobs, variants, and Agent runs remain available without copying or clearing browser data. Legacy `RESUME_OS_*` environment variables and AI request headers remain accepted as compatibility aliases; new deployments should use `JOB_SEEKER_AGENT_*` and `x-job-seeker-agent-*`.

## What “RAG” means here

JobSeeker Agent does not implement embedding search or a vector store. Its retrieval graph is typed and explicit:

- `CareerFact.evidenceRefs` points to one or more `EvidenceSource` records.
- `RequirementMatch.factIds` points from a target-job requirement to relevant career facts.
- optimization plans, questions, change sets, scores, and variants retain requirement/fact references.
- deterministic scoring reads the reviewed requirement status and evidence IDs; it does not accept a model-generated pass probability.

This is structured evidence retrieval for a resume-tailoring domain. It is intentionally not a general RAG knowledge base and does not crawl the web, chunk arbitrary document collections, create embeddings, or add a hosted vector database.

## Browser persistence

| Record | Browser storage | Notes |
| --- | --- | --- |
| Resume drafts and snapshots | `localStorage` | Structured resume data; sample/demo data is not promoted to verified evidence |
| Evidence sources and career facts | IndexedDB | Imported facts remain visually unconfirmed until reviewed; original file bytes are rejected by the schema |
| Target jobs, requirements, mappings | IndexedDB | Powers reviewable requirement matrices and deterministic alignment |
| Resume variants and optimization runs | IndexedDB | Enables job-specific versions and resumable state transitions |
| Job sources, search profiles, public postings, recommendations, application records | IndexedDB | Public job content plus local decisions and packet references; no platform sessions or credentials |
| Active workflow pointer and UI preferences | `localStorage` | Theme, motion, desktop layout, locale/provider preference |
| Strategy memory | `localStorage` | At most 20 explicitly applied, de-identified history simulations; independently inspectable, disableable, exportable, and clearable |
| Provider Base URL/model | `localStorage` | Per browser origin |
| BYOK API key | `sessionStorage` by default | Moves to `localStorage` only after explicit device-persistence consent |

Trusted resume readiness spans both storage layers: the structured draft must exist in
`localStorage` and its `EvidenceSource` must exist in IndexedDB. A missing evidence
record fails closed, blocks Job Agent execution, and can be retried from Resume Studio.

If IndexedDB is unavailable, JobSeeker Agent reports that Career Evidence or agent state was not saved; it must not display an in-memory result as durable. Deletion checks are restrictive: a draft, fact, requirement, job, or variant referenced by saved agent data is not silently cascaded away.

## Public job discovery boundary

`POST /api/jobs/discover` is a stateless same-origin proxy for dedicated Greenhouse and Lever adapters. Its request schema contains only `source: "greenhouse" | "lever"` and a public `sourceKey` of at most 128 restricted characters. It never accepts a URL, custom host, request headers, cookies, credentials, resume data, or career facts.

The adapters construct only these upstream requests:

- `GET https://boards-api.greenhouse.io/v1/boards/{sourceKey}/jobs?content=true`
- `GET https://api.lever.co/v0/postings/{sourceKey}?mode=json`

The browser materializes a versioned, reviewed Greenhouse/Lever source catalog and
refreshes at most ten selected automatic sources per market-search action. Target
company is optional, and additional public boards remain an explicit advanced input.
BOSS Zhipin and 51job are fixed-host official-search links only. 58.com is labeled as
requiring an approved Open Platform partnership; none of these three platforms are
fetched by `/api/jobs/discover`.

The Copilot import path is browser-local. A user may paste a selected platform job's
official HTTPS URL and description. The hostname must match the selected marketplace;
the application stores the supplied fields in IndexedDB and does not request the URL,
send it through a server route, or access marketplace cookies.
Labeled quick-paste parsing is deterministic browser code with a 100,000-character
limit. It only prefills editable fields and does not trigger persistence or navigation
until the user confirms “Import and analyze.”

Upstream requests use manual redirect handling and no credentials. Exact HTTPS hosts are fixed in code; response bodies are streamed with a 2 MiB limit, the source collection is limited to 500 postings, and the default timeout is 15 seconds. The same-origin request body is limited to 1 KiB and the route uses a 30-request-per-minute in-process bucket, enough for three maximum-size market refreshes. A public deployment must include `/api/jobs/discover` in its platform/distributed rate-limit policy because serverless instances do not share process memory.

The server returns normalized public posting data and does not persist it. The browser commits a refresh to IndexedDB only after the adapter completes and cancellation/stale checks pass. A complete response may close a disappeared posting; a partial response may not. Do not add another provider through a generic fetcher: review its official documentation and terms, add a dedicated exact-host adapter, and cover both allowed and rejected paths first.

No authenticated job marketplace is supported. The application does not store or replay session cookies, solve CAPTCHAs, automate final forms, infer submission from a page visit, or submit in the background. Final submission remains a user action on the employer site followed by a separate explicit local confirmation.

## AI provider policy

### Chrome Built-in AI (Beta)

The current adapter uses Chrome's `LanguageModel` API for bounded structured tasks. It checks task-specific input/output languages, normalizes availability (`unavailable`, `downloadable`, `downloading`, `available`), requires user activation before a required model download, can forward download progress when a caller supplies a progress handler, enforces the session context budget, applies a JSON response constraint, validates the parsed value, supports cancellation, and destroys the session after the task.

Chrome Built-in AI is initialized and persisted as the first provider preference. Every AI task reads the persisted preference when it starts; cloud calls also read the persisted Base URL and model plus the saved session/device key. Current product integrations cover raw resume parsing, Demo / Sandbox generation, target-job requirement extraction, scoped optimization-plan preparation, and one evidence-linked narrative-leaf rewrite at a time. Studio's local and cloud paths use the same prompts, structural JSON schema, normalized `ResumeData` validation, cancellation, and source classification. The local rewrite prompt contains only the selected path and original text, its approved plan item, and linked requirements/facts; it excludes contact details, unrelated resume sections, and the full JD.

Chrome owns model eligibility and download lifecycle. Availability can vary by browser, device resources, language, and model state. The [official Chrome Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) is the source of truth for platform eligibility.

### OpenAI-compatible BYOK

The browser sends the configured Base URL, model, and API key only to approved same-origin Next.js AI routes. The route uses them for that invocation and forwards the request to the selected provider without persisting or echoing the key. Provider URLs must use HTTPS in public deployments, redirects are rejected, and browser-selected hosts must match the built-in exact-host allowlist (`api.openai.com` and `openrouter.ai`) or `JOB_SEEKER_AGENT_ALLOWED_AI_HOSTS`.

Public browser requests require a complete BYOK configuration. `OPENAI_API_KEY` on the Vercel project is not a shared fallback for browser UI traffic. The `OPENAI_*` variables are used for loopback/local-only operation or authenticated server-to-server calls.

### No silent cloud fallback

Provider routing has three modes:

| Mode | Behavior |
| --- | --- |
| Chrome Built-in AI | Run locally or return a local availability/task error |
| OpenAI-compatible | Use the user's configured cloud provider by explicit selection |
| Automatic | Try local first; use cloud only for local model unavailability and only after saved fallback consent |

Automatic mode defaults to cloud fallback **off**. Context overflow, invalid structured output, cancellation, and other local errors do not silently cross the device boundary.

Chrome does not currently guarantee Chinese as a Prompt API input or output language. JobSeeker Agent therefore treats Chinese local AI tasks as experimental best-effort execution: it omits the unsupported `zh` capability declaration, sends the bounded task directly to the on-device model, and still requires the task's normal JSON schema, deterministic validations, cancellation, and stale-input checks where applicable. Invalid model output never triggers cloud fallback; model unavailability can use cloud only in Automatic mode after saved fallback consent.

## Data that crosses the device boundary

- A Job Agent discovery refresh sends the configured public provider enum and board identifier to the same-origin discovery route. That route fetches public posting data from the fixed official host. Resume drafts, career facts, recommendation scores, conversation drafts, application notes, and application status are not included in source requests.
- A PDF/DOCX/TXT upload is sent to the same-origin extraction route. Bytes are processed transiently and are not stored by JobSeeker Agent. The route returns extracted text.
- Pasted or extracted raw resume text is processed in the browser when Chrome Built-in AI is selected. It is sent through the same-origin parse route to the configured OpenAI-compatible provider only when that provider is explicitly selected or Automatic mode has saved fallback consent and the local model is unavailable or over its context budget.
- Demo / Sandbox generation follows the same saved provider preference. Locally generated and cloud-generated demo resumes are both classified as `ai-generated` and never become verified Career Evidence.
- Cloud agent tasks receive only the context assembled for that task, plus the user's instructions. Planning sends requirements, matches, facts already referenced by the Requirement Matrix, and a deterministic catalog of safe editable targets containing their paths, current text, and allowed transformations. The catalog excludes protected profile fields and unrelated resume sections. Change generation sends the full active structured resume and full target-job description so the provider can produce exact path/original edits, while requirement, match, and career-fact collections are limited to IDs cited by the approved plan.
- Chrome Built-in AI tasks run in the browser and do not pass their prompt through JobSeeker Agent route handlers.
- The same-origin route sees the BYOK credential for the duration of a cloud request, but JobSeeker Agent server code does not persist it.

Users should still review the privacy and retention terms of their chosen hosting platform and OpenAI-compatible provider. “No JobSeeker Agent server database” is not a claim that network infrastructure or an external provider has no operational logs.

## Quality, release, and deployment

The read-only `.github/workflows/quality.yml` workflow runs `pnpm check` and the
complete Playwright suite for pull requests and pushes to `main`. The repository
does not ship Git hooks, and `main` remains intentionally unprotected for a
single-maintainer workflow. Run checks proportional to the change directly
before pushing instead of relying only on remote CI. Release preparation,
publication, and production deployment remain explicit operations:

```text
explicit verification and release request
  → start from a clean, up-to-date main
  → run pnpm check locally
  → release-it calculates the next SemVer version
  → package.json + CHANGELOG.md + local version commit
  → push chore(release): vX.Y.Z directly to main
manual Release workflow from main with vX.Y.Z + full release commit SHA
  → verify main ancestry and package version
  → revision-native quality check against that exact revision
  → resolve live remote tag + GitHub Release state
  → create or validate immutable tag + published stable GitHub Release
  → revalidate live publication state without deployment credentials
  → Vercel production build and deployment from the released revision
```

There is no whole-tree ESLint or Prettier gate. Run the relevant direct checks
for each change and use `pnpm check` as the complete local handoff verification;
the Quality workflow adds the full browser suite remotely.
`.github/workflows/release.yml` never creates a release
automatically. A manual dispatch must run from the `main` ref and names both the
intended `vX.Y.Z` tag and the full release commit SHA. The workflow validates that
immutable input, reruns the handoff check, reads live remote state immediately
before any publication write, and verifies the resulting non-draft,
non-prerelease Release against the immutable tag and SHA. The deployment job
performs the same live verification before any step can read Vercel secrets.
Reusing the same exact published tag and SHA safely redeploys an existing
release.
`vercel.json` disables Vercel's direct deployment for `main`; Production remains
available only through the explicit Release workflow.

Every version change is prepared and checked locally on `main` before it is
pushed. The manual Release workflow independently validates the exact pushed
revision before any tag, GitHub Release, or production deployment is created.

### One-time GitHub configuration

Add these secrets to the `production` GitHub Environment:

| Secret | Purpose |
| --- | --- |
| `VERCEL_TOKEN` | Vercel access token used only by the tagged production deployment job. |
| `VERCEL_ORG_ID` | The linked Vercel project `orgId` from `.vercel/project.json`. |
| `VERCEL_PROJECT_ID` | The linked Vercel project `projectId` from `.vercel/project.json`. |

The workflow-level `GITHUB_TOKEN`, revision-resolution job, release-quality job, and
deployment job are read-only. Only the narrowly scoped `Publish tag and GitHub
Release` job receives `contents: write`; it runs after release quality succeeds.
Configure the `production` Environment with a custom deployment branch policy
that allows only `main`. All three Vercel values belong to that Environment so they
are unavailable to other jobs and refs. During the current migration,
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are Environment secrets;
`VERCEL_TOKEN` remains a repository secret only until its value can be rotated
or re-entered, and must be moved into the Environment before the next production
release.
The repository Actions policy allows only GitHub-owned actions pinned to a full
commit SHA. Keep this policy aligned with every `uses:` entry before introducing
another action.

Keep the remote repository settings aligned with these boundaries:

| Setting | Required value |
| --- | --- |
| Actions default workflow permissions | Read-only; workflows cannot approve pull requests |
| Allowed Actions | GitHub-owned only; full-length commit SHA required |
| `main` protection | Disabled; no branch protection rule or ruleset, so the maintainer can push directly |
| Pull-request merge methods | Merge commits disabled; squash and rebase enabled |
| `production` Environment | Custom deployment branch policy restricted to `main`; all Vercel credentials stored as Environment secrets |
| Secret scanning | Secret scanning and push protection enabled |
| Code scanning | CodeQL default setup enabled for JavaScript/TypeScript and Actions |

CodeQL may still run through GitHub's separately managed default setup. Treat any CodeQL alert as a security finding that must be reviewed rather than as a release signal.

Before pushing, inspect commits for sensitive files, secrets, whitespace errors,
and valid release metadata, then run the checks required for the change. Fixtures
must remain synthetic because local Playwright traces can contain rendered form
values and mocked request details.

### Version rules

The current package baseline is `0.3.0`. Release-it examines commits since the
previous version tag and ignores commits that do not match a releasable
Conventional Commit type.

| Conventional Commit | SemVer result |
| --- | --- |
| `fix(scope): ...` | Patch, for example `0.1.0` → `0.1.1` |
| `feat(scope): ...` | Minor, for example `0.1.0` → `0.2.0` |
| `feat(scope)!: ...` or `BREAKING CHANGE:` | Major, for example `0.1.0` → `1.0.0` |
| `perf(scope): ...` or `revert: ...` | Patch |
| `docs:`, `test:`, `build:`, `ci:`, `chore:` | No release by itself |

When explicitly invoked from a clean, up-to-date `main`, `release-it`
accumulates all unreleased commits, chooses the highest required bump, updates
`package.json` and `CHANGELOG.md`, and commits `chore(release): vX.Y.Z`. Its Git
tag, push, and GitHub Release operations are disabled. Push the generated commit
directly to `main`.

After pushing, open **Actions → Release → Run workflow** and enter both `vX.Y.Z`
and the full release commit SHA now reachable from `main`; leave the workflow ref
set to `main`. The workflow fails closed for any other dispatch ref, a non-main
commit, version mismatch, malformed SHA, or inconsistent live publication state.
It runs the released revision's `pnpm check`. Tags created before `.nvmrc` and
`pnpm check` were introduced use their original Node.js 22 runtime, pinned pnpm,
and historical `typecheck`, `test`, and production-extraction gate
instead. Unknown legacy layouts fail closed. The workflow then applies this
state matrix immediately before publication:

| Live tag / Release state | Result |
| --- | --- |
| Tag missing; Release missing | Create both after the release-commit check |
| Tag points to another SHA | Reject |
| Exact tag exists; Release missing | Publish a Release from the verified tag |
| Release exists; tag missing | Reject |
| Release is a draft | Reject |
| Release is a prerelease | Reject |
| Exact tag and stable published Release exist | No-op publication; allow an idempotent redeploy |

After a create or no-op, the workflow resolves the remote tag to its commit and
verifies the published Release again. Deployment repeats that live check before
accessing Vercel credentials. If Vercel deployment fails, rerun the workflow
with the same tag and SHA; the existing release is validated rather than
recalculated or replaced. Never move or overwrite a version tag.

### Rollback and hotfixes

- For a normal fix, commit and push a `fix:` change to `main`. When a patch
  release is desired, prepare the release commit on the same branch.
- For an urgent traffic rollback, restore the previous deployment in Vercel, then follow with a `revert:` or `fix:` commit so Git history and the next patch version describe the production state.
- Never move or overwrite an existing `vX.Y.Z` tag.

## Vercel deployment

Vercel is the supported zero-server-management topology because it runs the Next.js App Router and route handlers required by this repository.

### Environment variables

| Variable | Vercel browser deployment | Purpose |
| --- | --- | --- |
| `JOB_SEEKER_AGENT_TRUSTED_PROXY=vercel` | Required | Trust Vercel's forwarded protocol/IP only when the Vercel runtime marker is present |
| `JOB_SEEKER_AGENT_ALLOWED_AI_HOSTS` | Optional | Comma-separated exact `host[:port]` additions for browser BYOK providers |
| `JOB_SEEKER_AGENT_LOCAL_ONLY` | Must be unset | Loopback-only mode would reject public clients |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Not required for browser BYOK | Local-only or authenticated server-to-server provider configuration |
| `JOB_SEEKER_AGENT_AI_ACCESS_TOKEN` | Optional; server-to-server only | High-entropy bearer token of at least 32 bytes; never expose to client JavaScript |

### Deployment steps

1. Keep the GitHub repository connected to the existing Vercel project; `main` Production deployment remains disabled outside the Release workflow.
2. Store the Vercel token, organization ID, and project ID as secrets on the `production` GitHub Environment, whose custom deployment branch policy allows only `main`. Do not commit `.vercel/`.
3. Build from source on the GitHub-hosted Linux runner. The release workflow uses `vercel build --prod` and `vercel deploy --prebuilt --prod`; do not upload a `.next` output built on macOS because PDF extraction includes platform-native canvas code.
4. Set `JOB_SEEKER_AGENT_TRUSTED_PROXY=vercel` in Preview and Production. Keep `JOB_SEEKER_AGENT_LOCAL_ONLY` unset.
5. Add only the exact additional BYOK provider hosts users need. Treat this list as an SSRF boundary.
6. Add a Vercel Firewall or another distributed rate limit for `/api/`, including `/api/jobs/discover`. The built-in process-memory limiter is defense-in-depth and is not shared by serverless instances.
7. After explicit release creation, dispatch the Release workflow with the existing `vX.Y.Z` tag and confirm that tagged quality validation and the Production deployment both succeed.
8. Open Settings on Production, select the intended provider mode, and run the corresponding AI check.
9. Import both a TXT and a representative PDF/DOCX; add synthetic Greenhouse and Lever test boards, verify manual refresh/cancellation, complete a JD analysis and application packet, reload, and verify IndexedDB recovery on the deployed origin. Do not use a real resume in test artifacts.

### Complete-function conditions

The complete current raw-resume-to-job-variant workflow requires all of the following:

- Next.js route handlers are deployed and reachable at the same origin.
- browser site storage (`localStorage` and IndexedDB) is available.
- every browser user who selects cloud tasks or allows cloud fallback has saved a valid BYOK configuration.
- any selected cloud provider host is on the exact-host allowlist and reachable over HTTPS.
- platform-level rate limiting is in place for a public deployment.
- uploaded files fit the application's 3 MiB file and 4 MiB multipart limits.
- Chrome-only tasks additionally require a compatible Chrome environment, model availability/download, supported language, and sufficient context budget.

The 3 MiB/4 MiB application limits stay below Vercel Functions' documented [4.5 MB request-body limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). The extraction route uses the Node.js runtime and production output tracing for its PDF worker assets.

### Verification

```bash
corepack pnpm@11.17.0 install --frozen-lockfile
corepack pnpm@11.17.0 check
corepack pnpm@11.17.0 test:production-extraction
```

For a public deployment, also verify the browser network panel: Chrome-local tasks must not call cloud routes, Automatic mode with fallback disabled must stop locally, and cloud tasks must call only the same-origin API before the configured provider.

For Job Agent, verify that refresh calls only `/api/jobs/discover`, the server calls only the fixed Greenhouse/Lever hosts, cancellation leaves no partial browser commit, career data is absent from the request, and selecting a platform does not imply connector authorization. In the current MVP, opening an application URL does not mark it submitted and an explicit submitted confirmation is required. Any later messaging or submission connector requires its own token, revocation, receipt, retry, and allow/deny-path verification before deployment.

The optional Manifest V3 Browser Agent runs locally in Chrome. Its page bridge is
allowlisted to the shipped JobSeeker Agent origin and loopback development origins. It may
probe visible platform pages but must not request cookie permissions, export session
credentials, or report a send as successful without a platform receipt. New deployment
origins require an intentional manifest change and extension review.

The extension persists only a bounded runtime queue in `chrome.storage.local`: cycle ID,
scheduled time, reason, attempt count, and coalesced missed-interval count. Page closure
does not delete pending cycles. A reopened JobSeeker Agent page announces readiness, receives
one oldest cycle, and reports completed/failed/skipped before another cycle can dispatch.
Chrome startup restores the alarm and coalesces missed periods into one catch-up cycle;
it does not replay every missed interval or execute BOSS actions while Chrome is closed.
No job, resume, career fact, message body, platform credential, or cookie enters this
extension queue.

## GitHub Pages boundary

GitHub Pages serves static files and cannot execute the Next.js route handlers used for document extraction and OpenAI-compatible AI tasks. The current repository therefore cannot provide its complete workflow on GitHub Pages.

A separate static adaptation could retain the shell, local persistence, deterministic scoring, presentation routes, and supported Chrome Built-in AI tasks. It would still need an independently hosted API for upload extraction and cloud/raw-resume parsing, plus code changes for routing, CORS, authentication, SSRF protection, secrets, and rate limiting. That is a different deployment architecture, not a configuration switch.
