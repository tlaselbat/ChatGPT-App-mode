# Navigation layout and implementation history

The sections through Acceptance criteria describe the accepted implementation.
Later milestone sections preserve earlier measurements and test results, not
current layout specifications. See [verification evidence and coverage limits](LIVE_UI_AUDIT.md)
for the last reported accepted baseline; this documentation reconciliation does
not rerun or extend that verification.

## Codex-inspired surface

The navigation controller now implements a Codex-style persistent activity
rail: the custom 52px rail (`#app-mode-compact-sidebar-actions`) stays mounted
in every navigation state — compact, docked, and beneath the modal drawer —
instead of appearing only in the compact state. The shell therefore reserves
the rail width whenever the site itself does not reserve a rail column: a
rendered collapsed panel or a rendered native rail suppresses the offset, and
a rendered native rail beside a docked panel does too. A docked panel inside
the shell shifts right with the offset, so the layout reads rail | sidebar |
workspace in the expanded state.

The responsive docked width is keyed to the site's own
`data-app-shell-sidebar-open="true"` attribute, not our state marker. It
releases on native collapse intent so width-based detection can see the panel
shrink; without that flag, native width remains authoritative. Sizing and
account behavior are specified in the section refinement below rather than
in a second fixed-width model. The native modal drawer opens at `left: 52px`
beside the rail, retaining its dismissal, scrim, and focus trap; docked
navigation occupies its own column without a modal scrim.

Rail buttons gain a `data-app-mode-rail-active` selected state when the site's
`aria-current` link matches their label. The single rendered content `main`
is marked `data-app-mode-workspace` and painted as the rounded workspace.
There is no unconditional workspace top spacer for a second header row;
ambiguous structure stays native. Surface, radius, and spacing values live
as `light-dark()` tokens on the marker body.

## Section-based navigation refinement

The sidebar adapter recognizes native `section.group/nav-section` wrappers,
`group/nav-section-title` headings, and `button.group/section-toggle` controls
inside the active panel's `.sidebar-navigation`. Native disclosures remain the
source of truth, including an already-expanded Recents section. Their handlers,
project actions, links, additional sections, and persistence are not replaced.
The adapter never repeatedly closes an expanded native section.

A narrowly recognized Pinned, Projects, or Recents section without a native
control receives one adapter-owned disclosure button over its existing plain
heading. Only its sibling content wrapper is hidden; no native node is moved,
cloned, or deleted. These fallback sections initially collapse. Boolean-only
preferences use `app-mode-sidebar-disclosures-v1` in origin-local storage, with
an in-memory fallback if storage is blocked. Preferences survive native sidebar
replacement and are independent of the homepage Recent activity disclosure.
Unknown headings, interactive unsupported headings, and ambiguous wrappers
remain native. Cleanup removes adapter controls and owned markers when a panel
or recognized structure disappears. Existing reconciliation handles all updates;
there is no new polling loop.

The native scroll container, footer anchoring, drawer focus trap, dismissal, and
scrim color/alpha remain intact. Styling separates primary actions from compact
36px section headings, uses 14px collapsed-group gaps, and keeps native title
truncation and selected-state semantics. Only recognized sidebar wrappers receive
these rules. Docked widths are approximately 240–256px below 900 CSS pixels,
260–288px from 900px, and 288–320px from 1200px. These are sizing ranges, not new
sidebar-state breakpoints: the site's rendered panel/drawer and open flag still
determine layout, and the width override releases as soon as the flag closes.
The recognized direct inner wrapper can carry a native inline fixed minimum
width; normalize that wrapper only while docked-open so Search and section
content fit the resized panel. This override also releases on native collapse.

Account access remains native. The rail is the compact-state entry point; when
a docked panel or modal drawer exposes its own account row, that row remains the
primary entry point and the duplicate rail account action steps back. Recognized
account rows receive a smaller minimum footprint but no maximum height or hidden
account information. In particular, the rail outside a modal drawer is not used
to bypass its focus trap. A rail-opened native menu restores focus to the rail
when dismissal otherwise leaves focus on the body or an unavailable native
trigger; it does not override focus placed on another usable control or modal.
This uses a bounded mount observer and the existing shortcut cancellation
lifecycle, not polling. Unrecognized account controls remain untouched.

The sidebar change does not alter `WindowHost/`, the application title bar, caption
hit testing, Pin ownership, composer, homepage activity, or native chat rendering.
Visual tests distinguish native authoritative state from adapter-owned fallback
state and cover replacement, keyboard activation, navigation, account forwarding,
scroll retention, themes, drawer dismissal, and viewport-equivalent zoom geometry.
The geometry artifacts explicitly distinguish effective CSS viewport coverage
from actual native browser zoom verification.

## Ownership and scope

The [two-level header architecture](ARCHITECTURE.md#native-header-host)
places trusted application chrome above the page view and its native contextual actions.
The navigation controller in the shared page override owns the permanent
activity rail and the geometry applied to recognized native sidebar containers. A home-only layout controller owns the welcome/composer wrapper
geometry on the blank home route. ChatGPT retains its conversation layout,
editor content, sidebar contents, action handlers, dialogs, and focus trap.

The native DOM adapter recognizes the responsive shell attribute, the native
sidebar rail, `aside.app-shell-left-panel`, and the sidebar-specific
`browser-sidebar-popover` dialog. These are assumptions about the current
frontend, not a public API. Unknown markup must restore native navigation.

## Reconciliation and verification checklist

1. Consolidate native element discovery and activation in an adapter. Match
   only known navigation actions. Exclude App Mode controls to prevent
   recursion. Wait for mounted drawer controls; use the native menu keyboard
   handler for popup actions. If a shortcut is unavailable, leave the native
   sidebar available instead of hiding its entry point.
2. Derive one state from rendered panels, never solely from the site's stored
   open flag: `drawer` for a rendered native sidebar modal, `docked` for a
   rendered wide native aside, and `compact` otherwise. Preserve the native
   breakpoint instead of guessing it from window width.
3. Apply state in one reconciliation pass. Keep a set of owned attributes and
   remove stale attributes from retained or replaced nodes. Reserve rail space
   exactly once; retain the native desktop column's layout space when present.
   Keep the activity rail mounted in all states; suppress duplicate native
   controls only when a working replacement exists. Keep native scrolling intact.
4. Share the contextual header height, rail width, and responsive sizing through
   CSS variables. The docked panel and native drawer begin below the header.
   Apply the flag-keyed docked width only while open; preserve native drawer sizing.
5. Normalize toggle labels, expanded state, focus styling, and duplicate
   controls. Retain the modal's native dismissal and focus handling. Return
   focus to the App Mode toggle after the drawer closes when native focus
   restoration would otherwise target a hidden opener.
6. Validate transitions: compact to docked, docked to drawer on resizing,
   stale open flags without a visible panel, dismissal, repeated resizing,
   sidebar DOM replacement, SPA navigation, adapter failure, and disabled
   preference. Check action forwarding against delayed native controls.
7. Review masked live home-route captures at desktop, tablet, and narrow
   widths in light and dark themes. Exercise each rail action separately.
   Record numeric bounds and state only. Offline tests do not establish
   current-site compatibility or native host safety.

## Acceptance criteria

- One coherent rail/sidebar/workspace layout is maintained; no duplicate rail or offset.
- The header spans the viewport and clears the sidebar title and controls.
- Resizing never leaves an empty navigation strip or stale owned attributes.
- Native sidebar contents and their scroll position are not reconstructed.
- Shortcut failure preserves a usable native navigation entry point.
- Focus remains usable after opening and dismissing the native drawer.
- Unrelated configuration, profiles, and worktree changes remain untouched.

## Historical navigation-controller verification (19-test suite)

The shared override now contains a native navigation adapter and a controller
with one rendered-state model and a tracked attribute set. State cleanup
restores retained and replaced native elements. Resize reconciliation is
coalesced through animation frames. Native menu activation, delayed drawer
mounting, and stale desktop open flags are handled by the adapter.

The native modal close button occupies the same rounded header slot as the
custom opener while retaining the site's focus trap. The custom opener is
hidden during that modal state. Dismissal restores focus to the opener.

Verification performed:

- Existing full visual suite: 19 tests passed.
- Final focused checks: transition/action/scroll/focus/fallback test and the
  disabled-preference test passed. These include shell replacement and a
  nested popup temporarily making the rendered drawer aria-hidden.
- Isolated Electron home review: compact and expanded states across
  1280, 760, 620, 390, then 1280 CSS pixels in light and dark themes.
  Numeric bounds and masked screenshots were reviewed; captures remain in
  ignored `test-results/live-audits/navigation-controller/`.
- Search, Library, Explore, and New Chat were exercised at narrow and desktop
  widths. Desktop New Chat was checked from Library rather than only home.
- Native drawer dismissal, focus restoration, and retained drawer state
  during Explore's popup were checked in the isolated live profile.

This records frontend compatibility at that milestone, not a current release
certification or a guarantee against future native DOM changes. Unknown native markup restores the native layout.
No native host, launcher, server, profile, or release behavior was changed by
this consolidation; their suites were not rerun for these page-only changes.

## Historical modal-lifecycle correction (21-test suite)

Layout discovery and action availability are separate. Structural discovery
may retain rendered background elements while Search makes them aria-hidden
or inert. Action discovery continues to reject those blocked controls. A
separate blocked flag makes the custom navigation inert without removing it
or changing compact/docked/drawer geometry. A supported, connected layout is
also retained if its native entry point is temporarily absent during a modal.

Search shortcuts record whether the adapter opened a temporary drawer. A
bounded mount observer identifies the newly opened native Search dialog;
after dismissal it closes only that exact temporary drawer. Existing user
expansion is preserved. Root or drawer replacement cancels restoration.

Native toggle completion now waits for DOM/transition/animation events with
bounded timeouts. The stale-open-flag retry is driven by the observed cleared
flag rather than a fixed sleep. Navigation reconciliation is coalesced per
animation frame. The retained header updates its bleed geometry during a
modal so a finishing sidebar animation or resize cannot freeze an old offset.

Regression coverage includes a separate global modal making a docked sidebar
and its toggle inaccessible, preserved scroll position and input blocking,
temporary versus user-opened drawers, and header geometry across viewport
changes while the background header is aria-hidden. Live review covers both
Search invocation paths at 1280px and 620px in light and dark themes, including
resize while Search is open. Masked evidence is under ignored
`test-results/live-audits/search-lifecycle-fix/`.

Final validation for the modal correction: all 21 visual tests passed. Native
Search was exercised from compact and expanded navigation at desktop and
narrow widths, in light and dark themes, with viewport resizing while open.
Escape and the native close button both restore the initial navigation intent.
Library, Explore, and New Chat also passed desktop and narrow live checks
after removal of the fixed action delays. No native runtime or profile code
was changed by this correction.

## Historical home-screen consistency (22-test suite)

This milestone predates the later homepage refinement in `a370a65`. Its composer
height and suggestion placement below are historical measurements, not current
layout requirements. The accepted home presentation retains a native editor,
a bottom-aligned composer, and an independent Recent activity disclosure.

The home controller is restricted to the blank `/` route and validates a
rendered welcome heading and native editor form in separate branches of a
shared layout container. It marks native wrappers rather than moving or
cloning React nodes. Conversation routes remove every owned home attribute.

The home composition uses one vertical placement rule at all widths. The
composer wrapper is no longer sticky on narrow home pages, suggestions stay
below the editor, and wrapper padding, gaps, corners, and scrollbar gutters
remain consistent across the native 640px breakpoint. Card controls use a
container query: a single row when the card has room and two rows below 400px
of card width. Text may wrap naturally; no desktop viewport emulation or
page zoom is used in the implementation.

The fixture checks repeated resizing, the 640/639px boundary, draft retention,
horizontal overflow, suggestion order, and restoration of native sticky
conversation layout after leaving home. Live masked light/dark captures
cover 900, 640, 639, 620, and 390px and returning to 900px. At 640 and 639px,
the tested composer retained the same vertical position and 52px height;
the narrowest card used two control rows while staying in the same home
composition. Evidence stays under ignored
`test-results/live-audits/home-consistency/`. Native model selection and
Search were exercised after the layout change; the editor remained native
and editable. Live draft content was not entered or submitted.

All 22 visual tests passed after the home-layout change. Syntax and scoped
diff checks passed. The implementation did not change host zoom, viewport
metrics, user-agent settings, profiles, or native runtime behavior.

## Historical sidebar/header corner-boundary correction

The native sidebar column reserves the 40px subheader boundary even while
opening or closing. Previously that boundary was applied only after expanded
state detection, allowing intermediate animation frames to cross the row.
Structural detection now recognizes a panel wider than the compact rail and
retains its native reserved column without adding a second rail offset.

The native header's painted background can be clipped by content-column
ancestors. A pointer-transparent 52px corner surface completes the same header
background and bottom border beneath the toggle. It stays below the native
modal and both toggle variants, preserving drawer close interaction.

Isolated live review covered compact and expanded states at 1280px and 620px
in light and dark themes. The corner matched the header color and its toggle
remained the hit target. Masked crops are under ignored
`test-results/live-audits/corner-fix/`. A live animation sample recorded no
sidebar frames above the boundary. Four focused fixture checks passed for
the animation boundary, narrow navigation, modal header resizing, and home
composition. JavaScript syntax and scoped whitespace checks also passed.

## Historical merge validation (23 visual tests)

That milestone's merge review passed all 23 visual fixture tests, all five
runtime/release checks, and all seven Electron host checks. The first host
attempts encountered foreground/covered-window guards while the desktop was
in use; the unchanged host suite passed with the desktop idle. Temporary
diagnostic and activation experiments were removed before the successful run.
Profiles, local configuration, and live captures remain outside the commit.
