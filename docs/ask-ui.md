# Ask UI: visual spec and acceptance gates

This is the spec for the 問問看 (Ask) screen after the UI refinement. It records the rules the code
follows, the exceptions to them, and how each rule is checked. The checks live in `e2e/` (real
browsers) and in the Vitest `dom` project (behavior).

What does not change: Traditional Chinese copy, light and dark themes, Taiwan colors (red up, green
down), deterministic calculations, IME and Safari composition guards, Stop behavior, safe links,
glossary panels, local memory confirmation. The model explains; it never calculates.

## 1. Spacing scale

Base unit 4 px. Groups use 8 px steps. Only these steps appear in Ask.

| Role | Step | Tailwind |
| --- | --- | --- |
| Inside a text run (label to value, icon to text) | 4 px | `gap-1` |
| Between sibling controls | 8 px | `gap-2` |
| Inside a message (paragraph to paragraph, block to block) | 8 / 12 px | `gap-2`, `gap-3` |
| Heading to its own body vs. section to section | 8 px vs. 16 px (`mt-4`) | grouping by proximity |
| Between messages and between page regions | 24 px | `gap-6` |
| Page gutter | 16 px | `px-4` |

Padding by role:

| Role | Padding |
| --- | --- |
| Source chip, term chip | `px-2`, height from line box; hit area extended by `::after` |
| Notice, evidence box | `px-3 py-2` |
| Composer textarea | `px-3 py-2.25` (a 24 px line box makes a 44 px control with the 1 px border) |
| Panel (inspector) | `p-4` |

## 2. Keylines

One reading column, `max-w-[42rem]` (about 40 CJK characters at 16 px), centered in the content
region. The content region excludes the md+ sidebar and, when the inspector is open beside the
answer (viewport ≥ 1280 px), the inspector.

These share the same left and right edge, within 1 CSS px: header, lens fieldset, context line,
assistant content, composer. Elements carry `data-keyline="region|column|header|context|composer"`
so the geometry spec can find them without relying on class names.

The inspector sits beside the answer only at ≥ 1280 px. At 1024 px the sidebar, the 42 rem column
and a panel do not fit, so below 1280 px it is a sheet (right side from 768 px, bottom sheet below).

## 3. Typography roles

| Role | Size / line | Notes |
| --- | --- | --- |
| Page title | 20 / 28, bold | |
| Answer body | 16 / 28 (`text-base leading-7`) | `tabular-nums` for figures |
| Answer heading (`**結論**`) | 13 / 20, semibold, tracking +0.05em | uppercase-style label, not a size jump |
| Label (buttons, lens) | 14 / 20 | |
| Metadata (domain label, evidence, footnotes) | 13 / 20 | one footnote summary line, details behind a disclosure |

Font stack: `"Geist Variable", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui,
sans-serif`. Geist has no CJK glyphs, so the fallback is named rather than left to the browser.

## 4. Control geometry

- Standalone targets are at least 44 × 44 CSS px. Inline term chips are inside running text; they
  keep a 20 px visual height and extend the hit area with an `::after` box so the line height does
  not change.
- Heights are `min-h-*`, never a fixed height that clips text at larger zoom.
- Send and Stop share one fixed `h-11 w-16` slot, so swapping them does not change the composer's
  outer box.
- The textarea is 44 px tall at every width. (Before: 46 px below `md`, 44 px from `md`, because the
  font size switched.)
- Radius pairs: a container's radius equals its child's radius plus the padding between them. The
  lens segments use `calc(var(--radius-lg) - 1px)` inside the 1 px border.
- The composer rests on the bottom of the screen before and after the first answer: the column has
  a `min-h` of the visible height and the composer `mt-auto`, so sending the first question does not
  move it. On `/ask` the shell's `main` bottom padding is `4rem + safe-area` (phones) / `0` (md+),
  so the sticky composer does not jump 32 px when the page reaches its end. Other routes keep
  `6rem` / `md:pb-8`.
- Ask controls do not move on `:active`. The shared `Button` has `active:translate-y-px`; the
  composer's slot opts out (`active:not-aria-[haspopup]:translate-y-0`).

## 5. CSS structure

No negative margins, no `!important`, no translated wrappers. Exceptions (each has a reason):

| Exception | Where | Reason |
| --- | --- | --- |
| `before:-inset-x-4` pseudo-element | sticky composer band | Paints the band's background across the page gutter without moving the composer's own box. It is a pseudo-element, not a margin; the composer's edges stay on the column keylines. |
| `after:-inset-y-2.5` hit-area boxes | inline term chip, source chip | Extends the pointer target without changing layout. |
| `before:border-border` on the band | sticky composer band | Pseudo-elements do not inherit the base-layer `border-border`; without it the band's top edge is black. |
| `[@media(max-height:30rem)]:static` + `before:hidden` | composer in a short landscape window | A sticky composer would take half the screen, and the band, with no sticky anchor, would cover the header. |
| `html:has([data-keyline="column"])` `scroll-padding-bottom` | `app/globals.css` | A focused control must not end up under the sticky composer. Chromium ignores `scroll-margin` for focus scrolling but honors `scroll-padding` on the root. `10rem` + safe area on phones, `7rem` from `md`, none in short landscape. |
| Sheet close button `absolute right-0.5 top-2` | inspector and My Data sheets | Keeps a 44 px target inside the panel padding. |

## 6. Color and contrast

- Text 4.5:1, non-text (borders of controls, focus ring, icons that carry meaning) 3:1.
- Market movement uses `--up` / `--down` with a sign or word, never color alone.
- Errors use `destructive`; stale or incomplete evidence uses `warn`. Status is always icon plus
  text.
- Muted text on the page background is checked in both themes (see the gate table).
- `--control` (oklch 0.6, both themes) is the edge of a field that has no inner label. It measures
  3:1 against the page; the shared `--border` (about 1.3:1) stays for dividers.
- Shared change: the light `--ring` went from 0.708 to 0.55 (2.6:1 → 3:1 focus border), and the
  shared outline `Button` gained `dark:focus-visible:border-ring` (its `dark:border-input` hid the
  focus border in dark mode). The planner, market, glossary and settings screens were compared
  before and after and are pixel-identical (section 12).

## 7. Motion vocabulary

- 150 ms opacity and transform only. Never animate padding, margin, height or alignment.
- `prefers-reduced-motion` removes the transitions.
- No per-token animation; streamed text just appears. Scroll-to-latest is instant.

## 8. State model

Two independent axes. A turn has one of each.

**Request phase** (what the connection did): `waiting`, `tools`, `generating`, `complete`,
`stopped`, `timeout`, `withheld`, `failed`, and `unknown` for turns restored from an older stored
chat that has no status.

**Evidence status** (what the answer can show): `pending`, `unavailable`, `unchecked`, `unknown`,
`none`, `partial`, `sources`.

Rules that keep them honest:

- A timeout notice followed by `finish` stays a timeout. `finish` ends the stream; it does not
  mean the answer is complete.
- A tool that "succeeded" only means the call returned. Whether it found data is the evidence
  record's `failed` flag, shown separately.
- Tool outcomes are `running`, `succeeded`, `failed`, `denied`.
- Waiting text depends on elapsed time (8 s, 20 s) and never gives an ETA or invented stages.
- A restored chat marks turns with no stored status as "status unknown (older record)" rather than
  "complete".

## 9. Evidence

The server sends per-source records in `data-verification.evidence.records` (at most 20, each with
at most 5 URLs, no passages, because the ledger stores none). The inspector shows tool, status,
data date, session, as-of, retrieval time (Asia/Taipei), links, truncation and warnings. A missing
field says "未提供"; nothing is inferred from the answer text. There are no tables or charts: the
backend has no structured comparison data to draw from, and the UI does not scrape prose.

## 10. Interaction rules

- The composer is never disabled. Offline or while an answer streams, the draft stays editable and
  Send is disabled with a visible reason. Nothing is sent automatically after reconnecting.
- Drafts persist in `muggle.ask.draft.v1` for 7 days. "Clear all my data" removes them. If the
  device refuses the write, a quiet note says the draft is not saved.
- The context summary (plan on/off, number of holdings, number of remembered notes) is built from
  the outgoing request body itself. Amounts are never shown.
- The lens (beginner / pro) is visible and applies to the next question; each answer shows the lens
  and context it was asked with.
- Retry after a failure or timeout reuses the original request (same lens and context) unless the
  user picks "retry with current settings".
- Editing the last question replaces that question and its answer; the screen says so first.
- Follow-up chips fill the composer; they never send.
- A remembered note is editable before accepting, and "saved" appears only after storage succeeds.
- New Chat explains that it clears the conversation on this device and that saved data stays.

## 11. Defects found, and what is only a guess

**Verified** (reproduced in a test or measured in a real browser before the change):

| Defect | Evidence | Fix |
| --- | --- | --- |
| A tool error and a tool success were both `done: true`. | `use-ask-chat.test.tsx`, failing first. | Tool states `running / succeeded / failed / denied`. |
| A timeout notice followed by `finish` showed as a normal finish. | Failing unit test written before the fix. | A timeout notice wins over a later `finish`. |
| An answer stored on the device lost its status, lens and evidence. | `stores.test.ts`. | Stored answers keep status, lens, context and bounded verification; old entries read as 「狀態未知」. |
| The textarea was disabled offline and while streaming. | `composer.test.tsx`. | Never disabled; Send is disabled with a visible reason. |
| A draft was lost on reload. | `ask-chat.test.tsx`, stream spec. | `muggle.ask.draft.v1`, 7 days, removed by clear-all. |
| Textarea was 46 px tall below `md` and 44 px from `md`. | `before/measurements`. | 44 px at every width. |
| The composer box spanned the full screen width while its textarea started at 16 px (negative-margin offset). | `before/measurements`. | Header, context line, answer and composer share x = 16..374 at 390 px. |
| Term chips were 32 px pills inside running text. | `before/measurements`. | Inline chip, hit area extended by `::after`. |
| The composer jumped 32 px at the end of the page. | Geometry spec. | Ask-specific `main` padding. |
| A focused chip could sit under the sticky composer. | Geometry spec (focus not obscured). | Root `scroll-padding-bottom`. |
| Textarea edge 1.26:1 / 1.47:1 against the page; light focus border 2.6:1; dark outline button lost its focus border. | `contrast.spec.ts`. | `--control`, darker light `--ring`, `dark:focus-visible:border-ring`. |

**Not verified** (kept as hypotheses; no change was made for them):

- The Send/Stop swap costs nothing measurable; the lab numbers (section 12) are the same before and
  after, so no performance claim is made.
- Keyboard behavior on real phones (see section 14).
- Whether people prefer the inspector beside the answer: it is a design choice, not a measured
  defect.

## 12. Measured gates

Chromium, Firefox and WebKit, Playwright 1.64.1, `zh-TW`, `Asia/Taipei`, DPR 1, reduced motion.
Screenshots and per-state measurements are in `docs/ask-ui/before` (checkout of `main`) and
`docs/ask-ui/after`; the stream recording is `docs/ask-ui/after/slow-stream-stop.webm`. The "before"
set holds all widths in the light theme and dark at 390 and 1440 only.

| Gate | Result | Checked by |
| --- | --- | --- |
| Shared edges and centers within 1 px; centered in the content region | pass, 3 engines | `geometry.spec.ts` |
| Widths 320 / 390 / 768 / 1024 / 1440, 1024×768 and short landscape: no horizontal overflow | pass, 3 engines | `geometry.spec.ts` |
| 200% and 400% zoom: no horizontal overflow | pass, 3 engines | `geometry.spec.ts` |
| Standalone targets ≥ 44×44; focus not hidden by the composer or bottom bar | pass, 3 engines | `geometry.spec.ts` |
| Send and Stop have the same outer box; the composer rests at the bottom | pass, 3 engines | `geometry.spec.ts` |
| Stop cancels once; late chunks are ignored; a double click does not cancel | pass, 3 engines | `stream.spec.ts` |
| Timeout then finish stays a timeout; failure then retry sends the same body | pass, 3 engines | `stream.spec.ts` |
| Tool outcomes are distinct; delayed-response wording follows elapsed time (no ETA) | pass, 3 engines | `stream.spec.ts` |
| Follow-latest; scrolling up is left alone; 「回到最新」 returns | pass, 3 engines, 6 repeats | `stream.spec.ts` |
| Draft survives reload and offline; follow-ups never send; edit-and-ask-again | pass, 3 engines | `stream.spec.ts` |
| Inspector: keyboard, sheet on narrow screens, focus returns to the chip | pass, 3 engines | `stream.spec.ts` |
| Text 4.5:1 (3:1 large), empty and answered, both themes | pass | `contrast.spec.ts` (Chromium) |
| Textarea edge and focus borders ≥ 3:1, both themes | pass | `contrast.spec.ts` (Chromium) |
| Pixel baselines, 16 states | pass | `visual.spec.ts` (Chromium) |
| Planner, market, glossary, settings, home: pixel diff against `main` | 0 differing pixels in 20 screenshots (phone and desktop, light and dark) | `shared-screens.spec.ts` |

Lab performance (Chromium, dev build, 3 runs each, 232 chunks of a long answer, `main` on port 4174
vs this branch). These are lab numbers on one machine; they rank two builds, they are not field
data.

| Measure | Before | After |
| --- | --- | --- |
| Send: press to a frame showing the question and Stop | 20–32 ms | 17–32 ms |
| Stop: press to a frame showing Send | 22–25 ms | 22–25 ms |
| Time per chunk (one chunk per frame) | 16.6 ms | 16.6 ms |
| Long tasks during the stream | 0 | 0 |
| Longest interaction | 48 ms | 48 ms |
| Layout shift | 0 | 0, except one case below |

A layout shift of 0.006 appeared in some phone runs when the script clicked Stop before any text
arrived. The script's click is untrusted input, so the browser does not mark it as recent input; the
skeleton (`min-h-14`) is removed in response to the click. With a real press `hadRecentInput` ignores
it. It is not a layout defect.

## 13. Coverage

| Layer | Covers |
| --- | --- |
| Vitest `node` and `dom` (happy-dom) | contract (`evidence.records`), phases, stores, composer, message list, inspector, a11y checks, copy |
| Playwright, 3 engines | geometry, overflow, zoom, targets, focus visibility, stream control, follow-latest, drafts, inspector |
| Playwright, Chromium only | pixel baselines, contrast (canvas color resolution), lab performance, shared-screen comparison |
| Not tested | real phones and their keyboards, Safari on iOS, field Web Vitals, screen readers (only role, name and live-region structure are asserted) |

`bun run test:browser` starts `vite dev` on port 4173 (or reuses one that is running) and needs the
browsers once: `bunx playwright install chromium firefox webkit`. It uses no credentials or database;
`/api/ask` and the session are mocked.

Opt-in specs (skipped in a normal run):

- `ASK_SHOTS_DIR=<dir> bunx playwright test baseline --project=chromium` writes screenshots and
  measurements.
- `ASK_PERF_OUT=<file> [ASK_PERF_LABEL=<name>] bunx playwright test perf --project=chromium`.
- `ASK_VIDEO_DIR=<dir> bunx playwright test recording --project=chromium`.
- `SHARED_SCREENS=1 ...` compares the other screens; `E2E_BASE_URL=http://localhost:4174` points
  any spec at an already running server (for example a checkout of `main`).

Writing files inside the project root while `vite dev` runs can make Vite reload the page in the
middle of a test ("Execution context was destroyed"). The captures go to a directory outside the
project and are copied in afterwards; `vite.config.ts` also ignores `test-results/`, the report and
snapshot folders.

## 14. Remaining limitations

- The composer is sticky with safe-area offsets, but nothing follows the on-screen keyboard
  (`visualViewport`). That cannot be verified without a device, so none was added.
- Firefox and WebKit have geometry and stream coverage, not pixel baselines.
- There is no recording of the old UI for comparison, only screenshots.
- No tables or charts: the backend returns no structured comparison data, and the model's prose is
  not parsed for it.
- The inspector shows what the ledger recorded (tool, dates, session, as-of, retrieval time, up to
  five links, truncated / stale / failed flags). The ledger stores no passages, so there are no
  excerpts, and missing fields read 「未提供」.
- After a reload the original request body is gone, so retry on a stored answer is labeled
  「以目前的資料重新提問」.
- The screenshots in `docs/ask-ui/after` were taken before the last small copy changes; the
  Chromium snapshots in `e2e/visual.spec.ts-snapshots` are current.
