# Job Agent lifecycle command center design QA

- Source visual truth: `/Users/17a/projects/job-seeker-agent/docs/design/job-agent-command-center-reference.png`
- Browser-rendered implementation: `/Users/17a/projects/job-seeker-agent/docs/design/job-agent-command-center-implementation.png`
- Full-view comparison: `/Users/17a/projects/job-seeker-agent/docs/design/job-agent-command-center-comparison.png`
- Focused top comparison: `/Users/17a/projects/job-seeker-agent/docs/design/job-agent-command-center-focus-top.png`
- Focused lifecycle-table comparison: `/Users/17a/projects/job-seeker-agent/docs/design/job-agent-command-center-focus-table.png`
- Mobile evidence: `/Users/17a/projects/job-seeker-agent/docs/design/job-agent-command-center-mobile.png`
- Viewport: 1487 × 1058 CSS px in Chrome for the desktop comparison; 390 × 844 CSS px for the mobile check.
- Source pixels: 1487 × 1058.
- Implementation pixels: 1487 × 1058. The explicit Chrome viewport and saved implementation pixels match the source 1:1, so no density resampling was required before comparison.
- State: Chinese Job Agent overview using live local data. The implementation shows 101 discovered roles, Agent paused, and BOSS connected; the source mock shows 19 roles and Agent running. These are intentional live-state differences, not visual substitutions.

## Full-view comparison evidence

`job-agent-command-center-comparison.png` places the selected concept and the final Chrome capture on one canvas at equal size. Both use the same 240 px navigation rail, full-width status hero, six-stage lifecycle, three primary opportunity rows, white surface, cobalt action color, emerald verified states, fine dividers, and low-elevation treatment. The implementation preserves real job titles and states instead of replacing them with concept data.

## Focused region comparison evidence

- `job-agent-command-center-focus-top.png` verifies the brand rail, headline hierarchy, connection state, Agent mark, actions, stage icons, counts, connector arrows, and progress rail.
- `job-agent-command-center-focus-table.png` verifies the row count, row height, typography, column alignment, semantic status colors, separators, and disclosure affordances.

## Required fidelity surfaces

- Fonts and typography: the implementation uses Inter with Noto Sans SC/PingFang fallbacks, a 27–36 px responsive display heading, 14 px lifecycle labels, and 12–14 px row text. Weight, truncation, line height, and Chinese wrapping match the concept hierarchy while retaining accessible live strings.
- Spacing and layout rhythm: the 240 px sidebar, 236 px hero, six equal lifecycle tracks, 146 px rows, and three-row overview reproduce the source proportions. Lightweight row separators replace nested cards, and detail disclosure expands without shifting unrelated controls.
- Colors and visual tokens: warm white/white surfaces, ink foreground, slate dividers, cobalt primary, and emerald verified states map directly to workspace tokens. No gradients or glass effects were introduced.
- Image quality and asset fidelity: the screen has no photographic or illustrative assets. Existing Lucide line icons are the closest installed family to the source icons and remain sharp at native size. Source company logos were concept-only data; the implementation deliberately uses a neutral document icon because the live records do not carry verified brand assets.
- Copy and content: all fixed copy exists in Chinese and English. Live counts, companies, targets, timestamps, BOSS state, and application stages remain sourced from the local domain store.
- Accessibility and motion: navigation, disclosure buttons, headings, table roles, focus rings, 44 px primary controls, and mobile cards remain keyboard/touch reachable. Entrance, stage, row, disclosure, and status transitions are disabled under `prefers-reduced-motion`.

## Comparison history

1. Earlier P2 — lifecycle rows were too dense: five rows at 120 px made the implementation read like a compact admin table instead of the selected command center.
   Fix: limited the overview to three live rows, increased row height to 146 px, and moved strategy learning behind a lightweight disclosure.
   Post-fix evidence: the final full-view and table-focused comparisons show the same three-row rhythm as the source.
2. Earlier P2 — table copy was optically smaller and the stage strip lacked the source connector arrows.
   Fix: raised job/status/detail type to 12–14 px and added icon-library chevrons between lifecycle stages.
   Post-fix evidence: the top and table focused comparisons show aligned hierarchy and visible stage direction.
3. Earlier P2 — the mobile view exposed a horizontally compressed desktop table.
   Fix: converted lifecycle records to two-column mobile cards, kept the stage rail independently scrollable, preserved 44 px actions, and hid the desktop-only profile control.
   Post-fix evidence: `job-agent-command-center-mobile.png`; the mobile Playwright route also passes its no-horizontal-overflow assertion.
4. Earlier P2 — development hot reload retained stale missing-message errors in the Next issue overlay.
   Fix: completed both locale bundles and performed a clean hard reload.
   Post-fix evidence: the final implementation screenshot contains no issue overlay. Browser logs were checked; historical HMR entries predate the final reload and did not recur.

## Interaction and runtime checks

- Overview → Opportunities → Overview navigation works without an RSC navigation request.
- A lifecycle row expands and collapses its bounded audit detail with correct accessible labels.
- Desktop and mobile routes render without document-level horizontal overflow.
- `pnpm check` passed: typecheck, 116 test files / 1029 tests, and production build.
- Relevant Playwright coverage passed: 11 tests passed and 9 intentionally project-scoped tests skipped across desktop and mobile.

## Findings

No actionable P0, P1, or P2 visual differences remain.

## Follow-up polish

- [P3] The implementation retains Resume Tasks, Interviews, and Agent Activity as additional navigation entries because they are real product routes, while the concept showed only five entries.
- [P3] Verified company brand assets could replace the neutral document icon later if the product adds a trusted logo source.

final result: passed
