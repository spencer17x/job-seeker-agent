# JobSeeker Agent

[Live Demo](https://resume-os-phi.vercel.app/en) · [中文体验](https://resume-os-phi.vercel.app/zh) · [Deployment and data boundaries](docs/deployment.md)

JobSeeker Agent is a local-first, evidence-grounded job-search agent. It turns a trusted resume and explicit job preferences into discovery, qualification, independent job-specific resume copies, and verified recruiter communication. Starting the Agent grants one bounded managed-mode authorization; it does not ask for per-job, per-message, or per-resume confirmations. Login and CAPTCHA challenges remain user actions, and final application submission still requires the repository's explicit user confirmation boundary.

The current MVP runs while the browser is open and is scoped only to BOSS Zhipin. The bundled Manifest V3 Browser Agent detects the BOSS session without reading cookies and provides a fail-closed managed send adapter. It may open only the exact queued BOSS job conversation, then sends only after deterministic recipient, body, editor, send-control, and platform-receipt checks. Live BOSS selector verification is still required before treating the adapter as production-ready. The target product requirements are documented in [docs/product-requirements.md](docs/product-requirements.md).

The product is built around four principles:

- **Evidence before claims:** saved career facts are the boundary for resume content; missing evidence becomes a question, not an invented achievement.
- **Job-specific decisions:** the target role determines which verified experience should be emphasized.
- **Explicit activation:** platform connection alone never starts the Agent. A trusted resume and saved job requirements are required, followed by an explicit Start action. Login challenges remain user actions.
- **Local-first ownership:** resume drafts and AI configuration stay in the browser. The server handles individual requests without persisting career data or API keys.

The primary workflow is:

1. Import an existing resume from the fixed BOSS online-resume page, upload a file, or paste resume text in Resume Studio. BOSS content is previewed before local evidence import.
2. Save the target titles, locations, constraints, and communication preferences in Job Agent.
3. Explicitly start the Agent. Only then does it enable its recurring browser schedule, detect available Chrome sessions, and run discovery.
4. The Agent extracts role requirements for ranking, then creates a deterministic `ResumeVariant` by copying the trusted resume and setting the target role. It does not ask AI to rewrite claims and never mutates the master resume.
5. The Agent opens the exact queued BOSS job conversation, verifies the recipient and final content, sends outreach, handles bounded follow-ups, and sends the linked PDF after a verified recruiter request.
6. Login, QR/SMS/2FA/CAPTCHA challenges pause for the user. Formal application submission remains a single explicit user confirmation and is never inferred from opening a page or sending a message.

Simulated resume generation is a **Demo / Sandbox** for exploring the interface. It does not represent verified user history and should not be used as the evidence source for a real application.

Resume 3D, Resume Book, Projects, Timeline, and Terminal are secondary showcase views over the same structured resume. They demonstrate presentation possibilities without replacing the evidence-driven tailoring workflow.

## What kind of agent is this?

JobSeeker Agent is a **job-search domain agent**, not an unrestricted computer-use bot. Its bounded loop is Career Profile → discovery → qualification → evidence mapping → job-specific material → recruiter conversation → outcome feedback. The model can propose structured output, but deterministic validators, platform capabilities, the saved autonomy policy, and evidence boundaries control what may be applied or sent.

The project uses a narrow, structured form of retrieval rather than a conventional vector RAG stack:

```text
EvidenceSource <- CareerFact.evidenceRefs
CareerFact     <- RequirementMatch.factIds
Requirement   <- OptimizationRun / plan / change-set references
```

There is currently no embedding pipeline, vector database, document chunk index, web crawler, or general knowledge-base retrieval. “RAG” in this project means retrieving locally stored, typed career facts and their explicit source relationships for the current requirement or agent run. This keeps claim provenance inspectable and makes deterministic scoring possible.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Vercel AI SDK / OpenAI-compatible BYOK
- Chrome Built-in AI `LanguageModel` adapter (Beta)
- `localStorage` for drafts and preferences
- IndexedDB for evidence, jobs, recommendations, application records, requirements, mappings, variants, and resumable agent runs

Active Job workspace relations are loaded through typed IndexedDB indexes keyed by
source draft, application, and conversation. Write transactions lock only the requested
stores and the stores required to validate their references; they do not take a fixed
whole-database write scope.

## Routes

```text
/{locale}                 Redirects directly to the Job Agent backend
/{locale}/studio          Resume import, drafts, and Demo / Sandbox generation
/{locale}/jobs            Job Agent overview
/{locale}/jobs/setup      First-run resume, analysis, job criteria, and delegation wizard
/{locale}/jobs/opportunities  BOSS opportunity inbox and match detail
/{locale}/jobs/resumes        Job-specific resume tasks
/{locale}/jobs/conversations  BOSS conversation drafts and receipts
/{locale}/jobs/applications   Application progress
/{locale}/jobs/interviews     Interview rounds, Q&A, review, and outcomes
/{locale}/jobs/activity       Agent activity log
/{locale}/jobs/preferences    Search and import preferences
/{locale}/jobs/profile        Resume import and career profile inside the backend
/{locale}/jobs/target-job     Target-job analysis inside the backend
/{locale}/jobs/settings       Model, key, privacy, theme, and motion settings
/{locale}/agent           Evidence-grounded Resume Agent
/{locale}/jd-match        Target-job evidence and gap analysis
/{locale}/3d              Three.js resume scene
/{locale}/book            Animated book reader
/{locale}/classic         Review, compare, select, and print resume versions
/{locale}/projects        Project explorer
/{locale}/projects/[id]   Project detail
/{locale}/timeline        Career timeline
/{locale}/terminal        Terminal-style resume
/{locale}/settings        Theme, language, motion, layout, and local AI configuration
```

Supported locales are `en` and `zh`.

The Job Agent workspace keeps Career Profile, Job Preferences, and Settings
reachable on desktop and mobile. Opportunities can be searched locally by title,
company, or location, with 20 roles per page and filters for ignored and closed
roles. Mobile selection opens the role detail with a return path to the selected
row; long descriptions can be expanded in full. These controls do not change
deterministic ranking or the explicit submission boundary.

Canceling a discovery run stops further processing after the current browser
step completes and ignores late results from that step. Completed local results
are retained. Saving a role updates its recommendation and application together
in one IndexedDB transaction, preserving any existing application progress and
notes even when the displayed list is stale.

## Development

```bash
corepack pnpm@11.17.0 install
corepack pnpm@11.17.0 dev
corepack pnpm@11.17.0 check
```

`pnpm check` is the authoritative local verification command: it runs
typecheck, the unit/integration suite, and a production build (not Playwright
e2e). The read-only [Quality workflow](.github/workflows/quality.yml) runs
`pnpm check` plus the complete Playwright suite for pull requests and pushes to
`main`. The repository does not ship Git hooks, so still run the checks relevant
to a change before committing or pushing. There is no required whole-tree
Prettier/ESLint gate; keep formatting consistent with nearby files.

The supported local runtime is Node.js 24.18.0 (`>=24.18.0 <25`).

`pnpm dev` binds to `127.0.0.1:3001`. When that port is owned by another process, use a separate loopback port without killing an unrelated service:

```bash
JOB_SEEKER_AGENT_LOCAL_ONLY=1 corepack pnpm@11.17.0 exec next dev --hostname 127.0.0.1 -p 3114
```

For local development, either configure the AI service in Settings or create `.env.local`:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

Theme (`system`, `light`, `dark`), motion (`system`, `full`, `reduced`), and desktop layout are stored independently. Resetting desktop layout does not delete resume drafts.

## Local data and server boundary

JobSeeker Agent does not require a server-side database, account system, or cloud-sync service. The browser origin owns the durable product state:

Existing installations are migrated in place: legacy `resume-os*` localStorage values are copied to the new `job-seeker-agent*` keys when first read, while the IndexedDB database keeps its historical `resume-os-domain` name to preserve career evidence and Agent runs. New operational configuration uses `JOB_SEEKER_AGENT_*`; legacy `RESUME_OS_*` variables remain compatibility aliases.

| Data | Storage | Sent off-device? |
| --- | --- | --- |
| Structured resume drafts and snapshots | `localStorage` | Only when required by an explicitly selected cloud AI task |
| Career evidence, postings, recommendations, application records, target jobs, requirements, mappings, variants, agent runs, BOSS conversations, interview rounds, Q&A, and reviews | IndexedDB | Job discovery stays in the local browser bridge; career context leaves the device only for an explicitly selected cloud AI task |
| Provider choice, theme, motion, desktop layout | `localStorage` | No |
| Versioned strategy memory from explicitly applied history simulations | `localStorage` | No; exports are initiated locally by the user |
| OpenAI-compatible Base URL and model | `localStorage` | Included with same-origin AI requests |
| BYOK API key | `sessionStorage` by default; `localStorage` only after explicit “remember” consent | Relayed through the same-origin route to the configured provider; never persisted by JobSeeker Agent server code |

Uploaded PDF/DOCX/TXT bytes are processed transiently by the same-origin extraction route and are not written to the domain store. The original document bytes are not stored in IndexedDB. Clearing site data, using a different browser profile, or moving to a different deployment origin produces a separate local workspace unless the user exports or migrates it separately.

A pasted, uploaded, or explicitly reviewed BOSS-imported draft becomes Agent-ready only after its local Career Evidence
source is committed to IndexedDB. If that write fails or browser storage is blocked,
discovery and setup remain disabled and Resume Studio offers an explicit retry; the
draft is never treated as evidence-ready merely because it exists in `localStorage`.

## Job Agent platform and action boundary

Job Agent starts from the resume rather than a required target company. Its first release supports only BOSS Zhipin. Platform availability never implies that the browser send adapter is enabled:

- BOSS Zhipin opens a fixed-host official search carrying the primary target title.
- Resume Studio can explicitly open only `https://www.zhipin.com/web/geek/resume` through the local extension, return at most 40,000 characters of visible resume text, and show it for review before parsing and local Career Evidence import. It never reads cookies or returns raw HTML, and the imported text reaches a cloud parser only under the existing explicit provider/fallback preference.
- BOSS Zhipin session detection and the managed send protocol are implemented. After the one-time Start action, the adapter may open only the exact queued BOSS job URL and its unique communication control. It refuses to send unless BOSS exposes stable recipient and conversation IDs plus a unique editor, exact body, send control, and a newly observed platform receipt.
- The web app requires Browser Agent bridge protocol v11 for managed BOSS actions. An older injected content script is shown as “reload extension” instead of being mistaken for a current authenticated connector. Protocol v11 distinguishes BOSS access restrictions from login and CAPTCHA states so scheduled platform requests stop until the visible session recovers.
- When the local Browser Agent is present on a BOSS search-results tab, it imports at most 50 bounded visible job cards, validates their hosts, scores them locally, and automatically queues eligible roles scoring at least 70. Queuing means “prepare for analysis,” never “submitted.”
- When no BOSS search tab is open, the extension constructs a fixed-host search from the primary configured title, scans at most three bounded result pages into a 50-job deduplicated set, and closes every inactive temporary tab. JobSeeker Agent never passes an arbitrary URL to the extension.
- While enabled, the extension persists a bounded, content-free cycle queue and runtime heartbeat in `chrome.storage.local`. Every 15 minutes it queues work before attempting delivery to a JobSeeker Agent tab. If Chrome is running but the page was closed, the extension may reopen only the last allowlisted localized `/jobs` URL in an inactive tab; arbitrary or cross-origin saved URLs are rejected. The page dispatches the oldest cycle and waits for a completion receipt before rate-limited delivery of the next. Chrome restart coalesces missed intervals into one catch-up cycle rather than replaying a burst. Results and career data remain in the JobSeeker Agent origin; queued records contain only cycle IDs, timestamps, attempts, missed-interval counts, and the allowlisted control-plane URL—never cookies, resumes, jobs, or private inbox content.
- Each queued role receives a posting-bound Target Job, stable OptimizationRun, and deterministic job-specific `ResumeVariant`. Up to three roles per Agent cycle are analyzed sequentially for ranking and requirement extraction, but resume prose is not AI-rewritten: the trusted resume is copied unchanged apart from job-specific target-role metadata.
- Once a validated job-specific resume reaches `ready-to-apply`, JobSeeker Agent creates one BOSS default-greeting opening draft and drains it automatically in managed mode. Clicking the exact posting-bound communication control may cause BOSS to send that greeting itself; the Agent selects a company/title-unique recruiter row and reconciles the exact-body message ID inside the active conversation instead of sending a duplicate. Message state is persisted separately as draft, awaiting validation, validated, sending, sent, delivered, read, or failed; external states require a matching recipient, body fingerprint, platform message ID, and receipt status.
- Verified incoming BOSS message nodes are reduced inside the extension to bounded event types such as recruiter reply, resume request, interview invitation, offer, or rejection. Raw inbox text is not returned to the JobSeeker Agent page or persisted. These events advance the local recruitment stage without allowing older or repeated events to regress it.
- Each new event may create one idempotent, job-bound reply draft from a fixed safe template. Resume requests are acknowledged only after the attachment receipt is verified. While a thread is waiting for a reply, the Agent may prepare a follow-up after 72 hours, with at most two follow-ups per thread and never while another outbound draft is pending.
- Failed message and resume sends retain their safe failure code and use bounded exponential backoff starting at five minutes. Messages stop automatically after three receipt-less attempts; resume retries remain attached to the same verified thread and never create a second local application record.
- The web control plane polls only for BOSS session recovery. Completing a login or CAPTCHA transitions the session back to available and wakes the pending queue; normal recurring discovery and inbox work remain on the bounded 15-minute extension schedule rather than reopening platform pages every poll.
- In Autopilot mode, a generated reply or follow-up is sent only when the extension can re-verify that the currently active BOSS conversation is the same immutable recipient and conversation already bound to the thread. A different active chat cannot rebind the thread; the message remains in the review queue instead.
- Job Preferences includes a content-free adapter diagnostic. It reports only selector counts and readiness for discovery, conversation identity, message sending, and PDF upload across open BOSS frames. It never returns job descriptions, recipient names, or private message text, and zero/ambiguous matches remain not ready.
- When a verified recruiter thread requests a resume, JobSeeker Agent renders the application-linked `ResumeVariant` into a local, text-selectable PDF without a server round trip. Upload is accepted only when the extension re-verifies the recipient and conversation, exactly one visible current-conversation control accepts the PDF after hidden duplicate templates are excluded, the exact byte fingerprint matches, and BOSS exposes the exact filename with a new attachment or message ID. Otherwise the thread remains `resume-requested`.
- Applied optimization runs are detected automatically. When every packet check passes, the application advances to `ready-to-apply` and its single BOSS conversation thread/opening draft is created idempotently; users do not need to click a separate “prepare materials” step.
- Recipient validation probes all BOSS child frames and prefers stable platform recipient and conversation IDs scoped to the active editor/send surface. When a list row omits them, a provisional identity may be upgraded only after an allowlisted canonical posting URL, exact visible job title, company/title-unique recruiter row, compatible recruiter name, and exact-body platform message ID inside the selected conversation are bound together. A display name by itself remains diagnostic-only and cannot authorize a send. Typing is available only after the same target identity and editor checks pass again.
- In Autopilot mode, a successful recipient approval hands the exact approved body to the extension. The extension revalidates identity and body, snapshots existing platform receipt IDs, writes the editor, verifies its rendered value, clicks the unique send control, and accepts only a newly observed message node carrying an exact body match, platform message ID, and sent/delivered/read status. Resume uploads use the same pre-action receipt snapshot rule. Missing, historical, or mismatched receipts are persisted as failed attempts, never successful sends.
- Other marketplace and public-board parsers remain internal for backward compatibility with existing local data, but are not shown in the first-release Job Agent catalog.

For a role selected on BOSS Zhipin, the user may paste its official HTTPS
URL, title, company, location, and description into Job Agent. The URL is accepted only
when its hostname matches the selected platform. JobSeeker Agent never fetches that URL,
reads the platform session, or infers data the user did not provide. The imported role
is stored locally, scored against the active search profile, and handed directly to
Target Job for evidence review.

The quick-paste helper can parse a labeled job share (`Job title`, `Company`,
`Location`, `URL`, and `Job description`, with Chinese equivalents) entirely in the
browser and prefill the reviewable import form. Unlabeled plain text is treated only
as a description proposal; JobSeeker Agent does not guess missing identity fields or import
until the user reviews the form and presses the explicit action.

The automatic source classes remain:

- Greenhouse Job Board API at the fixed `boards-api.greenhouse.io` host;
- Lever Postings API at the fixed `api.lever.co` host.

The bundled catalog is a versioned source seed, not a server-side job database. A market search refreshes at most ten selected automatic sources. The browser calls only the same-origin `/api/jobs/discover` route with a strict provider enum and a bounded public board identifier. The route constructs the upstream URL itself, uses HTTPS GET without cookies or credentials, rejects redirects, limits the request to 1 KiB, limits an upstream response to 2 MiB and 500 postings, applies a 15-second timeout and per-process rate limit, and returns normalized records. It does not accept arbitrary URLs, headers, authorization data, or resume/career content.

Public-source refresh is manual. BOSS cycles remain queued when the JobSeeker Agent page is closed and are revalidated after the page returns. Closing Chrome prevents execution; on the next Chrome startup the extension restores its alarm, calculates missed intervals, and queues one bounded catch-up cycle. Partial source responses are shown as warnings and do not close missing postings. Matching and application state stay in IndexedDB. Demo/Sandbox resumes cannot enter the real application flow.

JobSeeker Agent prepares a checked local packet and opens the original employer application URL in a new tab. Opening that page never changes the application status. Only the separate user action “I submitted this application” records `applied` and `submittedAt`. Authenticated marketplace scraping, cookie reuse, CAPTCHA bypass, screening-answer invention, browser form submission, and unattended or bulk applications are outside the product boundary.

After confirmed submission, an interview invitation can move the application to `interviewing`. Each round stores its schedule, user notes, questions, and answers locally. AI review provides a summary, gaps, suggestions, and an explicitly advisory pass estimate based only on the supplied interview record. Durable `passed` and `failed` outcomes always require an explicit user report.

Applied history simulations are stored separately as bounded, versioned strategy
memory. Users can inspect the latest parameters, disable further learning, export the
memory as JSON, or clear it without changing current preferences or deleting resumes,
Career Evidence, jobs, conversations, applications, or interview records.

## AI providers and no-silent-fallback policy

Settings exposes three explicit modes:

- **Chrome Built-in AI (Beta):** this is initialized and persisted as the first provider preference. Supported structured tasks run in the browser with Chrome's browser-managed model. Availability depends on the browser, device, model download state, task language, and context budget. The project routes raw resume parsing, Demo / Sandbox generation, bounded requirement extraction, scoped optimization-plan preparation, and one evidence-linked narrative-leaf rewrite at a time through this adapter. Plan preparation receives only reviewed requirements/facts and a deterministic catalog of safe editable resume targets; protected profile fields and unrelated resume sections are excluded. The local and cloud Studio paths share the same prompts, structural JSON schema, normalized `ResumeData` validation, cancellation, and source classification. A local rewrite prompt excludes contact details, unrelated resume sections, and the full JD. Because Chrome does not yet officially guarantee Chinese Prompt API input or output, Chinese tasks use an explicitly marked experimental best-effort session that omits the unsupported `zh` capability declaration while retaining the same schema, evidence, cancellation, and stale-result validation.
- **OpenAI-compatible BYOK:** tasks use the Base URL, model, and key saved by the user. Selecting this mode routes Studio parsing and generation, diagnostics, and supported Agent tasks through the configured same-origin cloud routes.
  OpenRouter uses `https://openrouter.ai/api/v1` plus a complete provider/model slug such as `openai/gpt-4.1-mini`. Saving a BYOK configuration activates this mode. Loopback gateways must include their OpenAI-compatible `/v1` prefix when required by the gateway.
- **Automatic:** tries Chrome Built-in AI first. It may call the configured cloud provider only when the local model is unavailable or cannot fit the bounded task **and** the user has saved “Allow explicit cloud fallback.” The default fallback permission is off. Invalid output, cancellation, and other local failures are surfaced instead of silently changing the privacy boundary.

Every browser AI feature reads the same persisted provider preference at task start. Cloud calls also read the persisted Base URL and model plus the saved session/device key; unsaved form edits are never used implicitly. Chrome-only mode never calls an AI route; Automatic mode without saved fallback consent also stops locally when Chrome cannot run a task. PDF/DOCX/TXT byte extraction remains the deliberate same-origin, non-AI route before the extracted text is parsed by the selected provider.

Chrome may need to download its local model after a user action. JobSeeker Agent checks task-specific language availability for officially supported languages. For experimental Chinese tasks it checks general model availability, lets the local model attempt the Chinese prompt without claiming browser-level language support, then applies the same strict output validation. It exposes availability diagnostics, can forward download progress to a task UI, validates JSON against the task schema, checks the context budget, and destroys the session after use. See the [Chrome Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) for the browser-managed model lifecycle.

JobSeeker Agent supports per-browser BYOK (bring your own key) configuration for OpenAI-compatible APIs. The Base URL and model are stored in `localStorage`. The API key is stored in `sessionStorage` by default and is moved to `localStorage` only when the user explicitly selects “remember on this device.” Each AI request sends the configuration and the career data required for that task to the same-origin Next.js route. The server uses them for that invocation only and does not persist or echo the key or career data.

Public browser requests must be exact same-origin requests with a complete BYOK configuration. Cross-origin browser requests remain blocked. Provider URLs must use HTTPS and match the built-in exact-host allowlist. A deployment owner can append trusted OpenAI-compatible hosts with a comma-separated `JOB_SEEKER_AGENT_ALLOWED_AI_HOSTS` value. This allowlist is an SSRF boundary; do not add hosts you do not control or trust.

The shipped `pnpm dev` and `pnpm start` scripts bind Next.js to `127.0.0.1` and enable local-only mode. Local requests can use either the browser configuration or the `OPENAI_*` environment fallback. A public browser deployment requires complete BYOK headers for cloud AI requests; setting a shared `OPENAI_API_KEY` on Vercel does not turn the public UI into a shared-key AI service. For intentional server-to-server integration, configure a high-entropy `JOB_SEEKER_AGENT_AI_ACCESS_TOKEN` of at least 32 bytes and `OPENAI_*`, then run `pnpm start:server`. The access token is server-only and must never be exposed through client JavaScript.

The in-process route limiter remains defense-in-depth. Set `JOB_SEEKER_AGENT_TRUSTED_PROXY=vercel` on Vercel or `JOB_SEEKER_AGENT_TRUSTED_PROXY=cloudflare` behind Cloudflare to use the platform-provided client IP inside each instance. Public deployments must also configure a platform or distributed rate limiter because process memory is not shared across serverless instances.

## Versioned releases

Production is released from SemVer tags through an explicit release operation rather than from every `main` push:

```text
clean main → local pnpm check → calculate SemVer
           → package version + CHANGELOG commit → push main
manual tag + full release SHA → recheck → GitHub Release → Vercel Production
```

Release changes are prepared directly on a clean, up-to-date `main`. Run
`pnpm check` first, plus the production extraction smoke test and relevant
Playwright suite when a change warrants them. When a release is explicitly
requested, run `pnpm release`; release-it derives the next version from commits
added since the previous release:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE` creates a major release.
- `perf:` and `revert:` create a patch release.
- `docs:`, `test:`, `chore:`, and `ci:` do not create a production release by themselves.

`release-it` updates `package.json` and `CHANGELOG.md` and creates only the
`chore(release): vX.Y.Z` commit. It does not tag, push, or publish a GitHub
Release. Push that commit to `main`, then manually run the Release workflow from
the `main` ref with `vX.Y.Z` and the full release commit SHA. The workflow
verifies main ancestry and package version,
runs that revision's `pnpm check` (or its equivalent historical quality gate
for releases that predate `pnpm check`), resolves the live remote tag and GitHub
Release immediately before publication, verifies the published
non-draft/non-prerelease Release again, and only then deploys to Vercel. The
deployment job repeats that live check before it can read Vercel credentials.
Store `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as secrets on the `production` GitHub
Environment, whose deployment branch policy allows only `main`. See
[Deployment and data boundaries](docs/deployment.md#quality-release-and-deployment)
for setup, deployment retry, rollback, and the complete lifecycle.

## Deploy to Vercel

Vercel can run the complete current Next.js application, including Node.js document extraction and stateless AI route handlers. It does **not** replace the browser's IndexedDB/localStorage, and it does not require a server database.

For the complete raw-resume-to-tailored-variant workflow on Vercel:

1. Link the repository to the Vercel project once, then add the Vercel project IDs and access token to the `production` GitHub Environment as Actions secrets and restrict deployments to `main`.
2. Keep branch Preview deployments enabled. `vercel.json` disables direct `main` deployments so Production can only follow a version tag.
3. Build from source in GitHub Actions on Linux; do not upload a macOS-built `.next` directory because document extraction includes platform-native code.
4. Set `JOB_SEEKER_AGENT_TRUSTED_PROXY=vercel`; do not set `JOB_SEEKER_AGENT_LOCAL_ONLY`.
5. Add a Vercel Firewall or other distributed rate limit for `/api/`. The in-process limiter is not shared across Functions.
6. If users select an OpenAI-compatible host outside the built-in exact-host allowlist, add that exact host to `JOB_SEEKER_AGENT_ALLOWED_AI_HOSTS`.
7. Each browser user reviews the saved AI mode in Settings and runs diagnostics. Local Chrome AI is the initial persisted preference; users selecting OpenAI-compatible or allowing Automatic cloud fallback must also save a complete BYOK configuration.
8. The browser must allow site storage. Chrome Built-in AI additionally requires a compatible Chrome environment and an available browser-managed model.

The app enforces a 3 MiB resume-file limit and a 4 MiB multipart limit, below Vercel Functions' documented 4.5 MB request-body limit. PDF and DOCX extraction uses the Node.js runtime and includes its worker asset in the production trace. See [Deployment and data boundaries](docs/deployment.md) for the environment-variable matrix, privacy flow, and verification checklist.

GitHub Pages cannot host the complete current repository because it does not execute Next.js route handlers. A separately adapted static build could expose local presentation, pasted-text parsing, Demo / Sandbox generation, and other supported Chrome tasks, but PDF/DOCX/TXT extraction and OpenAI-compatible calls would require a separately deployed API and corresponding same-origin/security changes.

Run `pnpm test:production-extraction` to build JobSeeker Agent, copy the document function trace into an isolated sandbox, and verify real PDF and DOCX extraction both inside that trace and through the built API route.

## License

JobSeeker Agent is available under the [MIT License](LICENSE).
