# Live sidebar stability and compatibility completion

## Baseline and scope

Started from clean merged main `8e2f8d1e4cd6c181fc82e13e455c42c7a4f1a472`;
local main, origin/main and remote main matched. Created local
`codex/live-sidebar-stability`. Prior branches, evidence, configuration and profiles
were preserved. No remote write, release, deployment or unrelated Phase Five work.

The production change is confined to geometry coordination in `10-sidebar.js`.
No sidebar redesign, route/selection change, Share change, dependency, IPC, host
security or production-configuration change is included. The test configuration gains
an optional output-directory environment override so the literal `npm run test:all`
command can preserve prior evidence. Default test behavior remains unchanged.

## Review recovery

The existing listener belonged to the expected Electron `--live-review` process and
exact isolated root. The browser diagnostic version endpoint and raw CDP WebSocket
responded. Trusted controls were responsive and reported `presentation: recovery`;
other page targets had empty URLs rather than usable ChatGPT documents. No clients
were attached. This establishes a renderer/recovery state, not a dead browser transport
or a signed-out/corrupt profile. The original renderer failure and the precise reason
Playwright initialization waited on these targets remain unproven.

Invoked the existing trusted Close action on that verified owned window; it exited
normally. Relaunched through the unchanged supported launcher with the same profile,
without deletion, copying, reset or forced termination. Five repeated harmless reads
reported complete/installed state and no previous inspection observer, frame array or
mask attributes. Authentication was confirmed again with visible Log out.

A scoped Sol Medium read-only consultation verified that trusted Close is supported
in recovery and distinguished the caption view from the remote renderer. It found
that reload recreates only a destroyed view and that recovery events currently lose
their specific cause. No host/lifecycle implementation change was justified here.
An allowlisted recovery-reason diagnostic is a possible separately authorized follow-up.

After a later restart, a diagnostic closure still referred to its old closed Page;
rebinding the helper to an explicitly passed current Page resolved that automation
error. Current targets were healthy throughout that episode. No second competing
review instance or profile reset was used. Conversation SPA navigation and ordinary
reload subsequently completed without the prior recovery state.

Privacy masks now use constant CSS during captures, with no continuously walking
text observer. No private content, account labels, URLs, cookies or profile data are
exported. Whether prior instrumentation contributed to the earlier renderer failure
is unknown. The review window is closed normally before desktop integration checks.

## Root cause and correction

The original six-toggle reproduction was repeated at 1024 DIP with normal motion.
Native layout remained in bounds (minimum x approximately 59.984), while presented
workspace position reached **-45.688 CSS px**. At one sample, native layout x=153.473
combined with App Mode offset=-195.817 to produce presented x=-42.344. Thus the
correction, measured against an earlier wider layout, outlived the native collapse.
Pending and post-reconciliation samples and prior masked presented frames distinguish
the issue from a DOM-only pending read.

Two coordination changes address that mechanism:

1. Only a new native intent starts compensation. Width-based docked detection can
   catch up after native motion has already begun; it must not replay a stale compact
   position as a fresh transition.
2. While an existing compensation runs, its starting delta is rebased against live
   native layout before capture and on animation frames. The existing WAAPI clock,
   duration and easing are retained. CSS/native width changes need not emit mutations.
   Reversal captures this corrected visual position before starting the next correction.
   Frame work is cancelled on cancellation, replacement, finish, resize/reset paths.

This is not a viewport clamp or another movement/timing system. The presented position
is interpolated between a captured visual origin and the current native layout, rather
than applying an obsolete absolute delta to a moving native panel. Native widths,
responsive states, 52px rail, 8px gap and reduced-motion rules remain authoritative.

## Focused regression evidence

The original eight transition scenarios retain their existing assertions and titles.
A ninth 1024px dark scenario keeps the native panel mounted while its width changes;
the older fixture replaces that panel synchronously and cannot model this overlap.
It covers ordinary open/close, six 65ms toggles, reversal while active, settled retoggling,
resize to drawer and back, reduced motion, frame bounds, keyboard and final state.

Post-reconciliation geometry now also rejects negative workspace x. In the retained
panel case, smoothness accounts separately for the measured native layout displacement
and correction movement. Actual compositor evidence checks marker ownership/visibility,
movement, no left clipping and endpoints. Capture-event timestamps can bunch separately
from CSS/native updates; that case uses rAF geometry for velocity. The original eight
cases' pixel-velocity assertion is unchanged. No screenshot tolerance was increased.

The final controlled probe replaces the controller's geometry methods with the exact
three original methods from `8e2f8d1`, leaving production files untouched. It fails
the new left-boundary assertion at **-4.422px** (exit 1). The corrected case passes.
An earlier simplified linear-width probe failed to reject the old mechanism; it was
not accepted as evidence. The final retained-panel model and original-method comparison
supersede it. Initial fixture readiness/sampling failures are preserved in disposable
outputs, not relabeled as product failures or passing runs.

## Authenticated after-fix evidence

Three repeated 1024px normal-motion sequences recorded minimum workspace x=60 and
native layout x=60. Those initial capped sample windows ended before the final native
settle in some cycles; they prove the measured bounds, not final-state parity of every
request. A separate complete capture contains **168 masked presented frames** and
records final compact state, offset=0, no active animation, no pending reconciliation
and no horizontal overflow. Painted workspace boundary minimum was **61px**.

The pixel scan follows the contiguous workspace surface from its right edge at y=80.
An initial left-to-right color search also matched a same-colored sidebar patch;
that classification was corrected after inspecting the alleged zero-boundary frame.
The image showed the workspace at x=60, not clipping. The corrected numeric method and
all selected PNGs are preserved; no image was accepted merely because capture succeeded.

Representative 390/680 drawer and 1280 docked interactions passed with rail width52,
zero settled offset and no horizontal overflow. Narrow Escape restored trusted-toggle
focus. At 1280, trusted-button focus was not retained after the measured sequence;
focus had moved into the remote document. This is recorded as an additional focus
observation requiring a separate native comparison, not silently corrected here.
Reduced-motion sampling had no negative workspace positions and all offsets were zero.
Native motion remains visible, and the original fixture scenarios verify intermediate
ordinary movement and the retained compensation animation. No universal frame-rate
or physical-display smoothness claim is made from screencast timestamps.

Current numerical records and masked images:
[live evidence directory](../test-results/live-audits/sidebar-stability-aj4MHw/).
The prior accepted before-frame is retained in the
[post-merge review](../test-results/live-audits/post-merge-compatibility-9NXevt/index.md).

## Selection and native Share comparison

| Check | Current live result |
| --- | --- |
| Home / Library SPA | Correct New chat / Library selection |
| Existing native Pinned conversation | Correct Pinned selection; persists through expansion/contraction and native drawer mounting |
| Responsive sidebar lifecycle | Native desktop panel retained while a fresh drawer mounts; not claimed as deletion of the old panel |
| Plugins | Correct Plugins selection, backed by native `aria-current=page` |
| Project conversation | Five entries were mounted under native Projects. After following one, the destination no longer had exact mounted membership/current semantics and remained unselected, including after reload. Positive project selection is unavailable; conservative unselection is verified. No membership inferred. |
| Project landing | No native landing link mounted; no route invented or account project created |
| Scheduled | Both current delegated and original native button left home active without a distinct dialog/destination; selection check unavailable |
| Explore | No distinct destination reached through the available action; unavailable |
| Ambiguous membership | No actual conflicting native memberships identified; unavailable |
| Native reconstruction | Ordinary reload completed with fresh installed page context and conservative state preserved |

Delegated Share on a standard existing conversation produced no visible dialog. After
the bounded timeout, status became degraded, the overflow control was removed and the
original native Share was unsuppressed and visible. A direct interaction with that
original button also produced no visible dialog. The masked capture confirms no modal
overlay. This verifies fallback restoration and does not establish an App Mode-specific
dialog failure or successful sharing. Native/frontend/service versus review-environment
cause remains unresolved. No link was created or published; Share implementation is
unchanged.

## Integration and delivery

The literal full aggregate gate completed successfully with
`APP_MODE_TEST_OUTPUT_DIR=test-results/runs/live-stability-integration`:

| Check | Result |
| --- | --- |
| `npm run test:all`, fixture/visual stage | 93 passed, zero skips |
| Runtime stage | 17 passed, zero skips |
| Native-host stage | 13 passed, zero skips, including real desktop interaction sequence |
| Aggregate exit | 0 |
| Windows PowerShell 5.1 and PowerShell 7 syntax | Both passed |
| Exact original-method negative probe | Expected exit 1; negative workspace x rejected |
| Screenshot comparisons | Twelve Chromium golden scenarios and existing comparisons passed; no updates or tolerance changes |
| Native composition | Four passed behavior/geometry checks; environment-specific native pixel comparisons unavailable in this run |
| Whitespace and source scope | Passed; no dependency, original baseline, host-security or Share changes |

[Integration review index](../test-results/visual-evidence/2026-11-08T08-05-38-313Z-3944/index.md)
and [manifest](../test-results/visual-evidence/2026-11-08T08-05-38-313Z-3944/manifest.json)
record 31 visual scenarios, overall passed and coverage unavailable where pixel evidence
is intentionally missing. This is not an assertion that every scenario has a golden
comparison. Tests ran on the working changes before the local task commit; metadata
accurately records the accepted baseline plus dirty state.

Inspected the new retained-panel settled, opening/closing intermediate, rapid-reversal
intermediate and resized-drawer captures; the controlled probe's failure images; and all
six saved masked live images. The prior accepted before frame remains linked above.
No difference images were generated by the passing comparisons. The magenta fixture
marker is intentional compositor instrumentation. Native mounting/clipped row labels
in the artificial narrowing panel are fixture presentation details, not another
production styling correction. All live images remain outside CI's synthetic allowlist.

Task-owned files: `extension/scripts/10-sidebar.js`,
`tests/visual/sidebar-transition.spec.js`, `playwright.config.js`,
`docs/VISUAL_TESTING.md`, and this report. Live artifacts remain ignored and outside
the synthetic CI upload allowlist. Existing evidence and persistent profiles are preserved.

The transition correction can be locally verified while destination coverage remains
partial. Live Share success, project-positive/ambiguous selection cases, the desktop
focus observation, physical mixed-DPI, prolonged Pin/opacity endurance and U-01 remain
separate open requirements. The narrow synthetic Close/identity observation was not
reproduced by the prior authenticated check and was not changed by this milestone.
