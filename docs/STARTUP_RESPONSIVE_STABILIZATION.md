# Startup and responsive interface stabilization

## Findings and changes

| Issue | Confirmed implementation condition | Resulting behavior |
| --- | --- | --- |
| Startup flash | The independent `did-finish-load` window-show listener ran while asynchronous CSS/script injection continued. Reloads had no equivalent cover. | The existing trusted view covers remote content until document-bound injection and initial reconciliation complete. Required readiness reveals immediately; optional unsupported adapters do not hold startup. |
| Alternate narrow chrome | Native-DIP compact sizing changed caption buttons at 480px while page-CSS rules independently changed header geometry at 480px/420px. Page zoom could put the two layers on different sides of those thresholds. | Caption controls remain 32×28 DIP in a 40 DIP title bar. Contextual icon geometry and native title padding remain consistent; home spacing changes continuously. |
| Missing options / redundant Share | The authenticated conversation header exposed native Share without a recognized conversation-options trigger. Discovery also accepted hidden options and could select retained hidden Share copies. | Prefer current rendered native actions. A scoped ellipsis delegates to native Share when native options are absent. Native menu integration is retained when available. |
| Sidebar/header presentation loss | The sidebar immediately reset its owned presentation when an opener temporarily disappeared, and selected the first shell regardless of whether it was stale/hidden. | Resolve the rendered shell, preserve supported adjacent openers, and retain validated presentation with forwarding disabled for at most 250ms during replacement. Unsupported structures release native entry points. |

The lifecycle regression cases reproduce transient opener removal, hidden stale
shells, body/header replacement, native modal suppression, and SPA navigation.
The authenticated pass did not reproduce an unexplained persistent marker loss.

## Loading and recovery contract

- Keep the existing two isolated views, sandboxing, permission/origin guards,
  document generations, and exact trusted caption sender/window validation.
- The native controls view has an opaque backing. Its document root and loading
  surface provide opaque theme bases even when sampled colors include alpha.
  Loading temporarily extends this view over the content; ChatGPT continues
  rendering underneath. Fullscreen loading hides the title bar.
- Successful required initialization and reconciliation reveal after a rendering
  opportunity. The 15-second deadline is a maximum recovery bound.
- Injection failure reveals a usable native document and revokes incomplete host
  navigation integration. A crashed, unavailable, or unresponsive renderer keeps
  a themed recovery surface with Reload.
- Reload is a fixed trusted action with no URL or selector arguments. Destroyed
  remote contents are replaced in the existing slot; the controls view is reused.
- Fixture hosts without an explicit isolated control port block production
  loopback calls. Live review also blocks production control calls.

## Responsive behavior retained

Native content and composer wrapping, sidebar docking versus overlay drawers,
drawer focus trapping/dismissal, native disclosures, and native action
availability remain authoritative. The compact rail stays 52 CSS pixels and
yields its reservation to expanded navigation. Page zoom scales page content;
the title bar remains at zoom 1 and 40 DIP.

## Prior authenticated stabilization review

These measurements predate the subsequent sidebar transition/selection polish
and title-bar toggle relocation. They do not establish authenticated live
verification of those later changes.

The isolated review profile showed a visible signed-in account menu. The selected
non-sensitive conversation was reviewed at 390, 480, 481, 620, 640, 680, 900, and
1280 native window widths, plus return-to-desktop resizing, in light and dark
appearances at 100% and 125% page zoom: **36 measured states**.

All measured states retained the 40 DIP title bar and 32×28 DIP caption buttons,
with a managed contextual header, no header-control overlap, no horizontal
overflow, and at most one owned ellipsis. The CSS viewport reduced naturally at
125% zoom; no viewport or user-agent spoofing was used.

Live interactions also verified:

- Drawer opening/closing at 390px and 680px, and docked navigation at 1280px.
- New-chat SPA navigation without document replacement, home reload, and
  Chat/Work switching at 390px, 640px, and 1280px.
- Ellipsis keyboard opening, Share-item focus, Escape dismissal, and focus
  restoration.

### Native Share limitation

Delegated invocation of the selected conversation's native Share action produced
no visible dialog at 390px, 680px, or 1280px. At 390px this also occurred with the owned
overflow bypassed, native pointer input, and App Mode presentation disabled.
The underlying native no-op remains undiagnosed; live Share-dialog success is
**unverified**.

The implemented failure path restores the original header Share when delegated
activation produces no native dialog within three seconds. This recovery was
verified live. Another route or replacement native action can retry. Sharing is
delegated to native behavior; no links were created through a separate sharing
implementation, and no unsupported conversation actions were added.

## Visual and geometry artifacts

Artifacts are local, ignored, and contain masked live content or synthetic
fixtures. No production browser profile was used or copied.

- [Before: narrow native Share presentation](../test-results/live-audits/stabilization/before-390.png)
- [After: narrow application window including trusted chrome](../test-results/live-audits/stabilization/after-native-390.jpg)
- [After: light narrow view](../test-results/live-audits/stabilization/after-light-390.png)
- [After: dark desktop view](../test-results/live-audits/stabilization/after-dark-1280.png)
- [Actual window loading capture](../test-results/live-audits/stabilization/startup/startup-loading.png)
- [Actual window ready capture](../test-results/live-audits/stabilization/startup/startup-ready.png)
- [Capture pixel measurements](../test-results/live-audits/stabilization/startup/capture-results.json)
- [Sanitized live geometry and interaction results](../test-results/live-audits/stabilization/live-results.json)

The 680×700 composited loading capture contained **zero magenta fixture pixels**.
The same persistent magenta background produced **39,984 magenta pixels** after
reveal, alongside **380,305 green content pixels**. This confirms that the
contrasting underlay existed and the window capture included the remote view
after reveal. Reload and
fullscreen loading captures also passed the obscuration check.

## Earlier stabilization verification

| Check | Result |
| --- | --- |
| Complete fixture suite (`npm test`) | 59 passed |
| Runtime suite (`npm run test:runtime`) | 13 passed |
| Host suite (`npm run test:host`) | 11 passed; native interaction case required an isolated retry |
| Focused native interaction retry | Passed; completes coverage of all 12 host cases |
| Focused Share/title-bar/lifecycle checks | 13 passed before the final complete fixture run |
| Windows PowerShell 5.1 and PowerShell 7 syntax checks | Passed |

A native run correctly refused input while the review window covered its
fixture. A subsequent Pin-state check also failed during desktop automation.
The review window was minimized and the desktop automation session released;
the focused native interaction rerun then passed. Ownership, foreground, and
covered-window guards remained intact. A direct capture of a fully covered child
surface was unsupported; opacity evidence uses actual composited window captures
before and after reveal instead.

Runtime: Node.js 22.23.2, Electron 44.10.0 (Chromium 152.0.7977.169),
Playwright 1.64.0. No dependency versions were changed.

Focused coverage includes every injection stage and stale-stage failure;
unsupported adapters; actual renderer crash and destroyed-view replacement;
failed top-level load; stale/subframe failures; recovery Reload; the 15-second
deadline; all requested native widths at actual Electron 100%/125% zoom; native
window controls and IPC rejection; Share menu variants, missing/hidden controls,
failed delegation, and replacement/navigation recovery.

The results above record the earlier stabilization pass. Subsequent sidebar and
title-bar changes have separate verification requirements.

## Sidebar and title-bar follow-up verification

The publish validation covered 62 fixture tests, 13 runtime tests, and all 13
host cases. Twelve host cases passed in the full run; the native interaction
case passed in a focused rerun after its legacy expectations were updated for
hidden header New chat and the rail's visibility transition. That rerun retained
the ownership, foreground, and covered-window guards. Windows PowerShell 5.1
and PowerShell 7 syntax checks also passed.

The native Electron fixture verified the sole title-bar toggle, docked/drawer
navigation, Search at the top of the compact rail, modal blocking, and fullscreen
fallback at 1280, 680, and 390 pixels. Authenticated live verification of these
later sidebar/title-bar changes remains incomplete; the prior live evidence
above is not a substitute for it.
