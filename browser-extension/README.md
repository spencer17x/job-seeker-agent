# JobSeeker Agent Browser Extension

This unpacked Manifest V3 extension is the local bridge between JobSeeker Agent and job
platform tabs. Version `0.1.0` is scoped only to BOSS Zhipin and reports its verified
session signals. On a visible BOSS search-results page it can also return at most 50
bounded job cards to JobSeeker Agent for local validation, scoring, and queuing. It never
reads or exports cookies.

The extension reports bridge protocol version `10` during session detection. The web app
fails managed actions closed when an older content script is still injected and asks for
an extension/page reload rather than treating that stale bridge as connected.

After a service-worker or unpacked-extension reload, the bounded `scripting` permission
is used only to inject the bundled `platform-probe.js` into one existing allowlisted BOSS
chat tab and its frames. This refreshes the probe without navigating or reloading the
authenticated page; no arbitrary source, target URL, or host can be supplied by the web app.

Given a bounded title query, the background worker constructs the fixed
`https://www.zhipin.com/web/geek/jobs` URL itself, opens it in an inactive temporary
tab, scans at most three result pages into one 50-job deduplicated response, and closes
each temporary tab. The page cannot
supply an arbitrary URL or host.

After the user starts managed mode, the `open-boss-conversation` action accepts only a
previously queued canonical `https://www.zhipin.com/job_detail/*.html` URL plus bounded
title and company identity. The page probe requires those identities in the visible job
page and exactly one visible communication control before clicking. A login or CAPTCHA
surface is brought to the foreground for the user; it is never bypassed. A BOSS 403
access restriction is reported separately and suspends scheduled platform work instead
of refreshing or retrying the restricted page. The resulting
chat is usable only when stable recipient and conversation identities can be inspected.

When Job Agent is enabled, the worker stores its schedule plus a bounded, content-free
cycle queue. A Chrome alarm queues work every 15 minutes before attempting to wake a
JobSeeker Agent tab. If Chrome remains running and the page is closed, the extension may
reopen only the last allowlisted localized `/jobs` URL in an inactive tab. It then
dispatches the oldest cycle and waits for a completed/failed/skipped receipt before another cycle can
run. Chrome restart restores the alarm and coalesces missed intervals into one catch-up
cycle. Only a localized `/jobs` workspace tab may receive a cycle; Studio and other
legacy tool tabs never report scheduler readiness. Job results, career data, resume content, credentials, and inbox content are not
persisted in extension storage. An explicit Resume Studio action may open only the
fixed BOSS online-resume page, return a bounded visible-text snapshot for local review,
and close the temporary tab; it never returns raw HTML or cookies.

On the same schedule, an already-open BOSS chat may be checked for an explicit,
incoming interview-and-scheduling signal. The page probe returns only a hashed signal
identifier and conversation identifier—not the message body. New signals are
deduplicated in extension storage and produce a generic Chrome notification. Unknown
or ambiguous message direction, missing platform message IDs, and unreviewed live DOM
shapes fail closed.

For a verified resume request, JobSeeker Agent may provide a bounded, locally generated
PDF to the extension when the active conversation exposes exactly one visible “upload
resume” control after hidden duplicate templates and image-only inputs are excluded.
The probe verifies stable platform recipient and conversation IDs,
conversation, filename, MIME type, byte length, content fingerprint, and a unique compatible file input before firing
the native change event. It snapshots existing attachment/message IDs and reports success only when one new platform attachment node
contains the exact filename and a previously unseen platform attachment or message ID. File bytes are never stored
in extension storage.

The `diagnose-boss-adapter` action exposes only bounded selector counts and readiness
booleans for open BOSS frames. It is intended for live selector review without
returning job content, recipient names, or message bodies. Readiness requires unique
conversation identity/editor/send controls, and resume readiness additionally requires
one visible current-conversation PDF resume control.

Conversation inspection runs in all matching frames, including BOSS `about:blank`
child frames. It returns a recipient only when one frame contains exactly one stable
platform recipient identity, stable conversation identity, recipient name, editor, and send control. Display-text-derived identities remain diagnostic-only. Ambiguous or
missing controls fail closed; inspection does not type or send a message.

For a posting-bound opening, the extension recognizes BOSS's exact default greeting and
selects only a recruiter row uniquely bound by visible company or title; if a newer reply
has replaced the row preview, it rechecks the original greeting inside the selected conversation. Stable platform
recipient and conversation IDs are preferred. A target-derived fallback identity is
permitted only when the canonical job-detail URL, exact visible title, unique recruiter
row, and a real platform message ID in the selected conversation are all present. A display name alone never authorizes
a send. If BOSS already marked the default greeting sent, delivered, or read, that receipt
is returned for local reconciliation and the extension does not type a duplicate opener.

After the one-time Start authorization, the managed send adapter repeats the same
recipient and conversation checks, recomputes the FNV-1a final-body fingerprint, writes through the native
editor setter, verifies the rendered editor value, and clicks the unique send control.
It snapshots existing message IDs before the click and returns success only after one newly observed message-content node exactly matches the body and its
platform message node exposes a previously unseen ID plus sent, delivered, or read status. Otherwise it
returns no receipt and JobSeeker Agent records a failed—not sent—attempt.

Message sending remains fail-closed and must not be treated as production-ready until
the current live BOSS selectors are reviewed. A send can be marked successful only
after deterministic recipient and final-content checks plus a platform receipt.

For local development, load this directory with Chrome's **Load unpacked** action.
The extension responds only on the bundled JobSeeker Agent production origin and loopback
development origins declared in `manifest.json`.
