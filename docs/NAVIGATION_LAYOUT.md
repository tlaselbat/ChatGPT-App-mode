# Navigation layout implementation plan

## Ownership and scope

The Electron host owns the title bar. The page header normalizer owns the
40px full-width subheader. The navigation controller in the shared page
override owns the compact rail and the geometry applied to native sidebar
containers. A home-only layout controller owns the welcome/composer wrapper
geometry on the blank home route. ChatGPT retains its conversation layout,
editor content, sidebar contents, action handlers, dialogs, and focus trap.

The native DOM adapter recognizes the responsive shell attribute, the native
sidebar rail, `aside.app-shell-left-panel`, and the sidebar-specific
`browser-sidebar-popover` dialog. These are assumptions about the current
frontend, not a public API. Unknown markup must restore native navigation.

## Implementation sequence

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
   Hide the compact rail in both expanded states. Keep native scrolling intact.
4. Share dimensions through CSS variables: 40px subheader, 52px rail, 40px
   icon targets. The docked panel and modal drawer begin below the subheader.
   Keep native panel widths; they serve different desktop and touch layouts.
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

- One navigation surface is visible in each state; no duplicate rail or offset.
- The header spans the viewport and clears the sidebar title and controls.
- Resizing never leaves an empty navigation strip or stale owned attributes.
- Native sidebar contents and their scroll position are not reconstructed.
- Shortcut failure preserves a usable native navigation entry point.
- Focus remains usable after opening and dismissing the native drawer.
- Unrelated configuration, profiles, and worktree changes remain untouched.

## Implemented and verified

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

This is current-frontend compatibility evidence, not a guarantee against
future native DOM changes. Unknown native markup restores the native layout.
No native host, launcher, server, profile, or release behavior was changed by
this consolidation; their suites were not rerun for these page-only changes.

## Modal lifecycle correction

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

## Home-screen consistency across widths

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

## Sidebar and subheader corner boundary

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

## Merge validation

The final release review passed all 23 visual fixture tests, all five
runtime/release checks, and all seven Electron host checks. The first host
attempts encountered foreground/covered-window guards while the desktop was
in use; the unchanged host suite passed with the desktop idle. Temporary
diagnostic and activation experiments were removed before the successful run.
Profiles, local configuration, and live captures remain outside the commit.
