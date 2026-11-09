# Active development status

App Mode remains in active feature development. The accepted application baseline is
`d6e9ab34fa89d46c4f3535e043e3a67fc2880872`; this local milestone addresses K-01.
This is not release-candidate preparation. Do not request monitor changes, physical
certification, endurance sessions or manual release acceptance during ordinary feature
work. Use automated checks and isolated authenticated review where safely available.

## Completed foundations

- Supported Electron host, sandboxed remote content and separate trusted controls.
- Established responsive workspace, native sidebar authority and compact selection.
- Automated fixture/visual, runtime and native-host regression infrastructure.
- Accepted sidebar rapid-reversal stabilization and compatibility fallbacks.
- Prior hosted Quality and integration evidence for accepted main. Current local work
  requires its own verification; historical passes do not establish new coverage.

## Current work and technical follow-ups

[K-01 keyboard accessibility](KEYBOARD_ACCESSIBILITY.md) connects document tab edges
without a privileged remote bridge or replacement focus model. Development continues
with intentional features, requested UI improvements and targeted optimization.
Accepted design decisions may be revisited when explicitly requested.

Keep native Share compatibility, conservative project selection and unavailable native
destinations distinct from host keyboard work. The original renderer-recovery trigger
is still unknown. Fixed-code recovery diagnostics remain a separate proposed task,
not part of this milestone. Assistive-technology and unusual upstream focus structures
need targeted compatibility evidence when relevant.

## Four proposed feature opportunities — not implemented

The focused assessment used the current architecture, host shortcuts, tray launch and
opacity menus, settings, and existing measurement infrastructure. These proposals
complement ChatGPT's navigation, conversations and search rather than recreate them.

| Priority / feature | Behavior and value | Complexity | Compatibility / maintenance risk | Expected components |
| --- | --- | --- | --- | --- |
| 1 — Configurable quick-summon shortcut | An opt-in Windows shortcut brings an existing App Mode window forward, or opens one when none exists; a second press can hide/restore it. Makes the app immediately reachable without navigating the tray or launching duplicates. | Medium | Shortcut conflicts, Windows foreground restrictions and minimized/closed targets; registration must fail clearly and clean up. No global remote-page keyboard forwarding. | Electron main lifecycle, native window targeting, settings/config defaults; reuse ownership and single-instance behavior. |
| 2 — Existing-window switcher | A tray list activates or restores an already open App Mode window. Use neutral labels/position by default and existing title-privacy preferences for any descriptive labels. Helps multi-window productivity; differs from New chat, recent-history links and the existing mini-window launcher. | Medium | Stale HWNDs, hidden/minimized windows and privacy-sensitive titles; revalidate ownership at activation and avoid collecting page content. | Tray menu, existing owned-window inventory, host activation adapter; no ChatGPT DOM navigation replacement. |
| 3 — Discoverable per-window zoom controls | A compact host affordance shows current content zoom with decrease/reset/increase actions. Makes existing Ctrl+/−/0 behavior visible and understandable while the title bar remains 40 DIP. | Low | Narrow header space, focus order and independent window zoom; must reflect actual host zoom and preserve native/browser shortcuts. | Trusted controls and main zoom state, existing shortcut helper, focused host/visual checks. No Windows DPI setting changes. |
| 4 — Measured reduction of inactive App Mode work | Coalesce or suspend only app-owned decorative/reconciliation work when a view is covered/minimized, with immediate safe resynchronization on return. Target lower idle CPU/layout work for multiple windows without pausing ChatGPT messages or native timers. | Medium | Missed DOM/theme updates after resume, false benchmark improvements or interference with readiness/focus. Establish a before/after workload and work-count/CPU budget before accepting changes. | Page coordinator, host-owned observers and existing performance harnesses; leave site networking, streaming and native content behavior intact. |

Zoom discoverability and inactive-work optimization can be developed independently of
the first two proposals and of each other. Quick summon and window switching share
owned-window activation concerns; agree on or reuse that small adapter first rather
than implementing duplicate targeting logic. Each feature still needs its own bounded
design and approval. No speculative feature implementation is included here.

## Deferred release validation

Mixed-DPI physical testing, thirty-minute Pin/opacity endurance, U-01 visible stacking
verification, and final packaging/release acceptance are postponed until the owner
prepares an actual release. They remain unresolved, not passed or fixed. Historical
[release validation](RELEASE_VALIDATION.md) remains the record of prior results and
limitations; it does not turn this development milestone into a release gate.

## Overall Development Progress

| Area | Status |
| --- | --- |
| Completed foundations | Electron architecture, responsive UI, automated regressions, sidebar stability and compatibility guards |
| Current development milestone | K-01 corrected and locally verified: automated suites plus focused authenticated boundaries; see its report |
| Features awaiting implementation | Quick summon, existing-window switcher, zoom controls, measured inactive-work optimization; owner choice pending |
| Remaining technical improvements | Targeted live/assistive-technology compatibility and separately proposed recovery diagnostics |
| Deferred release validation | Mixed DPI, Pin/opacity endurance, U-01 physical stacking, packaging/release acceptance |
| Recommended next task | Owner selects a feature; quick summon is the first recommendation after local K-01 review |
