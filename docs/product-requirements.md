# JobSeeker Agent Product Requirements

## Product direction

JobSeeker Agent is a user-controlled, cross-platform job-search agent. It uses a trusted
resume plus explicit job preferences to discover roles, qualify opportunities,
prepare job-specific material, manage recruiter conversations, and improve its
strategy from user corrections and real outcomes.

The agent is not a bulk-application bot. It must preserve career evidence, platform
rules, user intent, and a complete action history. The explicit Start action grants
managed execution for discovery, deterministic resume-copy creation, verified
recruiter communication, and requested-resume delivery without per-action approval.
Login/CAPTCHA challenges and the final formal submission confirmation remain user actions.

## Primary workflow

1. The user selects Start setup and describes the work they want in natural language.
   They may instead begin from selectable job-intent tags, or combine both methods.
2. The user imports a bounded BOSS online-resume snapshot for review, uploads, or pastes a trusted resume and waits for the structured resume
   analysis and local Career Evidence transaction to finish. A failed evidence write
   remains a repairable blocker rather than an Agent-ready resume. The Agent converts the prompt and resume-grounded suggestions
   into a typed, reviewable intent proposal; neither source silently becomes a saved
   search constraint.
3. The user confirms the proposal through grouped selectable tags and bounded custom
   values covering role family and specialty, industry or domain, titles, seniority,
   skills, locations, salary, experience, education, workplace/employment type,
   industries, company preferences/blocks, company size/stage, posting age, and terms.
   Unclear or conflicting intent remains a question until the user resolves it.
4. The user reviews the minimum match score and daily contact limit. The final explicit
   Start grants managed execution; there is no second delegation checkbox or per-message,
   per-job, or per-resume approval. A verified recruiter resume request automatically
   sends the application-linked PDF.
5. Model configuration and BOSS connection alone do not start the agent. Per-platform
   API configuration and platform selection are not part of the primary flow.
6. After explicit activation, the local Browser Agent detects platform sessions already
   available in Chrome and starts recurring discovery. A missing or expired session opens the relevant
   login page; login, QR code, SMS, 2FA, and CAPTCHA completion remain user actions.
   After the first successful login, the local browser session is reused without
   exporting cookies or credentials to JobSeeker Agent.
7. The agent continuously discovers and deduplicates roles, explains its ranking,
   and rejects roles outside hard constraints.
8. For a selected role, the agent creates an independent `ResumeVariant` by copying the
   trusted resume and setting job-specific target metadata. It does not request an AI
   rewrite and does not mutate the master resume. It then prepares an evidence-grounded
   opening message.
9. A conversation inbox groups recruiter messages, follow-ups, interview scheduling,
   and negotiation by job. Each outbound action records its source, approval policy,
   final content, timestamp, and provider receipt when available.
10. The user records or confirms outcomes. The agent improves targeting, timing, and
   message strategy while keeping learned strategy separate from career facts.
11. Interview rounds retain user-provided questions, answers, notes, and explicit
   outcomes. The agent may generate review suggestions and an advisory pass estimate,
   but it never records pass/fail without the user's confirmation.
12. A recruiter resume request selects only the application-linked job-specific
   variant. The browser generates a text-selectable PDF locally by default, with
   DOCX only as a verified compatibility fallback, and records `resume-sent` only
   after recipient, conversation, artifact fingerprint, filename, and platform
   attachment receipt all match.
13. De-identified recruiter events create at most one fixed-template reply. Waiting
    threads may create a follow-up after 72 hours, capped at two. Managed mode opens
    only the exact queued BOSS job conversation and still requires immutable recipient/
    conversation re-verification and an exact platform receipt; otherwise the action
    remains queued rather than being reported as sent.

## Job-intent understanding and selectable taxonomy

Prompt-first and tag-first setup are equal, combinable entry paths. A user may provide
only a natural-language prompt, only select tags, or use a prompt to obtain a proposal
and then refine it with tags. The Agent must preserve the user's original prompt so the
review surface can explain how every proposed constraint was derived.

Natural-language understanding must produce a typed proposal rather than directly
changing the active search profile. It may use the explicitly selected AI provider
under the existing local/cloud boundary, but model output remains untrusted: it must be
schema-validated, bounded, cancellable, and protected against stale input before being
shown. Deterministic parsing may provide an immediate partial result, but exact keyword
matching alone is not considered complete intent understanding. Ambiguous expressions
such as `PM`, `remote`, or `Web3 role` must produce a clarification or visibly tentative
tags instead of invented hard constraints.

The product-owned taxonomy uses stable IDs and localized labels. Role and domain are
orthogonal so, for example, a user can combine `Web3` with `frontend`, `backend`,
`sales`, or `community` instead of treating Web3 as a job title. The initial taxonomy
must group at least the following dimensions:

- **Role family and specialty:** engineering (frontend, backend, full-stack, mobile,
  QA, DevOps/SRE, security, data, AI/ML, blockchain), product, design, sales, business
  development, customer success, marketing, growth, content/community, operations,
  finance, legal, people/HR, and administrative work. Users can search the catalog and
  add a bounded custom title or specialty when no supplied tag fits.
- **Industry and domain:** Web3/crypto/blockchain, AI, fintech/payments, enterprise
  software/SaaS, e-commerce, gaming, healthcare, education, consumer internet,
  manufacturing, and bounded custom domains. A domain tag refines eligible companies
  and postings without asserting that the user has experience in that domain.
- **Level and qualifications:** internship/entry/mid/senior/lead/manager/executive,
  years of experience, education, required skills, preferred skills, and explicitly
  user-supplied language or sponsorship requirements.
- **Location and workplace:** country, region, city, timezone, remote, hybrid, on-site,
  acceptable remote geographies, relocation willingness, and commute radius when
  applicable. `Remote` never silently means worldwide; an unknown hiring geography
  remains an eligibility gap.
- **Employment and schedule:** full-time, part-time, contract, freelance/temporary,
  internship, shift, and schedule preferences.
- **Compensation:** minimum and optional maximum compensation, currency, pay period,
  and optional equity preference. Values with unknown currency or period require
  confirmation before they become hard constraints.
- **Company and freshness:** preferred and blocked companies, company size, financing
  or growth stage, posting age, industries, and required/preferred/excluded terms.

Each selected or proposed value must visibly distinguish `required`, `preferred`, and
`excluded` intent where those meanings apply. Prompt-derived values remain proposals;
an explicit tag selection, removal, or field edit takes precedence. If the user later
edits the prompt, the Agent shows a diff and asks which changes to accept instead of
overwriting prior selections. Resume-derived role and skill suggestions may broaden the
review choices but may never override explicit user intent or become verified career
evidence merely because they appear in the taxonomy.

The canonical taxonomy is independent of any marketplace UI. Each reviewed platform
adapter maps only the filters it actually supports. Unsupported preferences remain in
the local profile for deterministic qualification and ranking; the product must not
pretend that an unsupported platform filter was applied. Taxonomy changes are versioned
and migrated without clearing saved profiles, and all tag groups support both locales,
keyboard navigation, visible focus, and screen-reader labels.

The initial grouping is informed by common public job-search patterns: [LinkedIn job
search](https://www.linkedin.com/help/linkedin/answer/a8078917) exposes natural-language
input plus suggested filters, while its [standard filter
guide](https://www.linkedin.com/help/linkedin/answer/a507441) covers location, company,
experience, and employment; [Indeed's public search
guide](https://www.indeed.com/career-advice/finding-a-job/tips-on-how-to-get-better-search-results-on-indeed.com)
covers salary, posting date, remote, location, employment, experience, education, skill,
and schedule; [Wellfound](https://wellfound.com/jobs) separates role, industry/domain,
location, salary, and remote preferences and provides a dedicated [Web3 domain
view](https://wellfound.com/web3). These are reference dimensions, not authorization to
scrape a marketplace or copy its private taxonomy. The maintained product catalog must
be reviewed and versioned locally.

Acceptance criteria:

1. A prompt such as “Web3 frontend or full-stack, remote preferred, Shanghai hybrid is
   acceptable, at least 35K monthly, 3-5 years, no outsourcing” produces a reviewable
   proposal for domain, role specialties, workplace preferences, location, minimum
   salary, experience, and an excluded term without starting discovery.
2. A user can create the equivalent saved intent using tags and bounded custom values
   without entering a prompt.
3. Terms the user did not state and the resume does not support remain unset or become
   questions. The UI shows the source and confidence or tentative state of every
   inferred value before confirmation.
4. Conflicting prompt, resume, and tag values are shown together for resolution; an
   explicit user selection wins, and no background refresh changes the saved intent.
5. Search, messaging, and resume preparation remain disabled until the typed intent and
   delegation policy pass deterministic validation and the user selects the final Start.
6. Provider cancellation, invalid structured output, and stale prompt/resume results do
   not mutate the saved profile. Tests cover Chinese and English prompts, tag-only setup,
   ambiguous terms, conflicts, custom values, migration, keyboard access, and both hard
   and soft constraint behavior.

Current implementation status as of 2026-08-28: prompt capture exists, and its bounded
parser distinguishes salary from experience ranges, recognizes basic outsourcing
negation, and extracts a small set of role aliases. It still uses a fixed
title/city/keyword catalog and regular expressions, so it does not provide complete
semantic understanding, clarification, provenance, or conflict
resolution. The setup UI provides selectable workplace and employment types plus a
posting-age selector, while most other dimensions are comma-separated text fields; it
does not yet provide the grouped role/domain/location/company taxonomy required above.

## Job workspace information architecture

The Job Agent is a dedicated multi-route workspace rather than a single dense screen.
The localized product root redirects directly to this workspace; the former wallpaper,
desktop icon launcher, cinematic overview, and Dock are not part of the primary entry
experience. Legacy resume tools remain directly addressable while they are integrated
into the backend information architecture.
Its persistent navigation separates overview, opportunities, resume tasks,
conversations, applications, activity, and preferences. The overview emphasizes agent
state, the next actions requiring human attention, recent activity, and application
progress; opportunity review uses a list-detail layout.
Internal Job Agent navigation updates browser history without an RSC round trip so the
local store/controller remains mounted. Heavy profile, optimization, target-job,
settings, interview, and document-rendering modules load only when their section or
action is first used.

## Platform capability model

Being in the automatic catalog does not imply access. Every platform exposes independent
capabilities for discovery, messaging, scheduling, and application submission:

- **Fixed-host official search:** currently available for BOSS Zhipin.
  Results remain on the platform until its reviewed browser adapter is enabled.
- **Official search:** opens a fixed-host platform search without reading login state.
- **Local browser adapter:** uses the user's existing Chrome session and visible
  platform UI. Each adapter must verify the recipient, final content, and a platform
  success receipt. It must fail closed when selectors, session state, or page content
  are unknown.
- **Authorized connector:** uses an official API, approved partnership, or other
  platform-supported integration when one is available.
- **Unavailable:** the UI may prepare a draft or handoff, but must not simulate an
  integration or claim that an action completed.

The product must not use cookie replay, credential capture, arbitrary marketplace
scraping, CAPTCHA bypass, stealth browser automation, or fabricated platform receipts.

## Self-improvement boundary

The agent may learn from explicit user edits, saves, ignores, recruiter replies,
response latency, interviews, offers, withdrawals, and rejection reasons. Learned
state may change search queries, ranking weights, outreach style, and follow-up timing.

Learning must never invent or mutate career facts, protected resume fields, salary
history, work authorization, demographic information, screening answers, or an
application status. Resume claims remain bounded by trusted evidence and reviewable
job-specific variants.

Users can inspect, disable, export, or clear strategy memory independently from their
resume and application records.

Current implementation status as of 2026-08-28: explicitly applied history simulations
are retained as a bounded 20-version local strategy memory. The overview exposes the
latest applied parameters plus independent learning enable/disable, JSON export, and
two-step clearing controls. Clearing memory does not mutate current preferences or any
career/application domain record.

## Runtime and data model

The current MVP is local-first and runs only while the browser is active. It persists
preferences and strategy locally, uses reviewed public discovery, and includes a
Manifest V3 bridge that detects platform tabs without reading cookies. Platform send
adapters are enabled one at a time only after recipient, content, and receipt tests pass.

The BOSS first slice collects a maximum of 50 visible search-result cards, validates
every URL against the BOSS hostname, scores them deterministically, and queues open,
eligible roles at or above the saved threshold. The queue feeds the existing target-job
and evidence-grounded resume-variant workflow; it does not mark an application sent.

Opening Job Agent triggers a bounded BOSS search for the primary configured title.
The extension constructs the fixed host and path, uses an inactive temporary tab,
collects registered-frame results, and closes the tab. Callers cannot provide a URL.

Queued candidates are analyzed in bounded sequential batches. Each candidate owns a
posting-bound Target Job and stable OptimizationRun so similar descriptions from
different BOSS postings cannot overwrite one another. Extracted requirements remain
unconfirmed ranking inputs. Managed resume creation does not treat them as career facts
or use them to rewrite claims; it advances a no-op change set through the deterministic
state machine and stores an independent copy of the trusted resume.

Validated applications create a separate BOSS conversation thread and evidence-linked
opening draft. Approval is bound to the exact recipient and body fingerprint. Any edit
invalidates approval. `sent`, `delivered`, and `read` states require a platform receipt
whose recipient and body fingerprints match the approved message. IndexedDB schema v3
adds these thread and message stores without clearing v1 or v2 data.

The local orchestrator watches applied optimization runs. Once every deterministic
packet check passes, it advances the application to `ready-to-apply` and creates the
single opening thread and draft idempotently, without a separate preparation click.

The browser send path is Start-authorized and fail-closed. It opens only an allowlisted,
posting-bound BOSS job URL, verifies the unique communication control, repeats recipient
and conversation inspection, recomputes the final body fingerprint, verifies the editor
after writing, and clicks only one unique send control. A successful response requires
one exact-body message node, a platform message ID, and an observed sent/delivered/read
state. Anything else is stored as `failed`, not `sent`.

Continuous background operation requires a later scheduler and encrypted server-side
workspace. That phase needs an explicit product and privacy decision covering account
identity, connector tokens, retention, revocation, audit logs, retries, rate limits,
provider webhooks, regional storage, and deletion. It must not be introduced as a
silent extension of the current browser-only data boundary.

## Success measures

- Qualified roles surfaced per week, with user-rated relevance.
- Recruiter reply and positive-reply rates by platform and strategy version.
- Interview and offer conversion, without optimizing for raw application volume.
- User corrections required per outbound draft.
- Unauthorized-action count, unsupported-claim count, and false-completion count:
  all must remain zero.
