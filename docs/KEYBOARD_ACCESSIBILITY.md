# K-01 — cross-view keyboard accessibility

## Baseline and reproduction

Created local `codex/keyboard-accessibility` directly from accepted main
`d6e9ab34fa89d46c4f3535e043e3a67fc2880872`, after confirming remote main matched.
Preserved assessment branch/commit `fc65546`, all existing branches, the uncommitted
physical-validation companion report, evidence and isolated profiles. No reset, stash,
pull, rebase, remote write or branch deletion. Documentation on the assessment branch
was not silently folded into this implementation's ancestry.

The focused native-host regression failed on the unchanged implementation when real
Electron keyboard input attempted to move from caption Close into remote content.
The previously observed Sidebar→Pin→Minimize→Maximize→Close→Sidebar cycle was a host
document boundary problem, separate from normal native navigation focus transfer.

Electron 44.10.0 explicitly handles an outermost document's TakeFocus by calling
FocusThroughTabTraversal on that same document. There is no exposed cross-view edge
callback in the pinned WebContents API. See the
[pinned implementation](https://github.com/electron/electron/blob/v44.10.0/shell/browser/api/electron_api_web_contents.cc#L4492)
and [webContents focus APIs](https://github.com/electron/electron/blob/v44.9.3/docs/api/web-contents.md).
Two WebContentsViews therefore do not form one automatic sequential focus scope.
App Mode previously supplied no owning-host handoff between them.

## Correction

`WindowHost/keyboard-traversal.cjs` installs two small owned focus guards per document
in an isolated world. They bracket the document's native focus order. The leading
guard precedes positive tabindex values; Chromium still chooses all native destinations,
including embedded frame/shadow traversal. No list of native tabbables or composer
selector is maintained, and ordinary Tab presses are not intercepted.

When a boundary receives focus, the isolated pending observer yields only its edge
index and direction. A key observer records direction without cancelling ordinary Tab;
initial BODY traversal stays local. The host verifies window/view focus, attachment, current document binding,
ready ChatGPT content, visible title bar and modal state before entering the peer edge
and issuing one native Tab/Shift+Tab. Native modal/menu/listbox and fullscreen states
disable the relevant guards. A peer modal that precedes the host's state notification
rejects entry and preserves local wrap. Loading/recovery does not expose covered content.
The source must still have boundary focus immediately before handoff; a native focus
redirection or newer document cancels the old request instead of stealing focus.

No IPC channel/action, preload API, security privilege, dependency, application setting,
sidebar animation, navigation classification or screenshot baseline changed. The remote
page has no privileged bridge. Page code can manipulate its DOM, but a focused boundary
cannot authorize a window action or bypass the host's focus/ownership/lifecycle guards.

Full navigation invalidates old watchers. Reload reinitializes in the new document;
destroyed-view replacement removes the old binding and attaches the new view; window
close disposes observers and owned guards. A focused lifecycle run exposed an initial
cleanup bug in the new helper: accessing a destroyed view's webContents getter interrupted
replacement. Cleanup now retains its bound WebContents reference. That implementation
failure was fixed, not relabeled as an environment skip.
Rearming a retained document cancels an older pending boundary callback rather than
leaving it orphaned. A cancellation contract check retains the real fixture document
and verifies that subsequent native Tab traversal still works. The custom fixture
protocol does not reliably deliver did-fail-load on stop(), so that test supplies the
fixed -3 signal to exercise the existing retained-page branch after the actual stop;
it does not claim to certify every browser navigation-failure path.

## Verification record

The initial unchanged-baseline failure is the controlled negative reproduction. New
tests send native keyDown/char/keyUp events to the actually focused owned WebContents;
focus assignment only establishes explicit starting points. Assertions check actual
webContents ownership plus active destination and focus-visible, not emulated
document.hasFocus() alone. Enter/Space include their character events, matching a
complete keyboard activation sequence. Test setup waits for modal dismissal state and
adds its terminal native button after the rail mounts, rather than assuming the rail
has no additional tab stops.

Focused coverage includes forward/reverse edges in both directions, normal within-bar
order, native positive tabindex, dynamic SPA content, remote reload, window restoration,
drawer/docked expansion/contraction, Return/Space, Escape restoration and native modal
Tab handling. The established startup test retains every previous assertion and adds
checks for loading/recovery isolation and traversal after actual renderer recovery and
destroyed-view replacement. No authenticated renderer is fault-injected.

## Completed local integration

| Check | Current result |
| --- | --- |
| Fixture/visual suite from `npm run test:all` | 93 passed; no baseline updates |
| Final `npm run test:runtime` | 17 passed, 0 failed, 0 skipped |
| Final `npm run test:host` | 14 passed, 0 failed, 0 skipped, including native foreground-input sequence and new keyboard regression |
| Windows PowerShell 5.1 / PowerShell 7 syntax | Both passed |
| Controlled baseline reproduction | New boundary assertion failed on the unchanged implementation, before adding the correction |
| Existing caption IPC rejection and zero-extra-write assertions | Passed unchanged |

The initial aggregate command completed all 93 fixture checks, then stopped with two
runtime VM-loader failures: the new relative helper import was resolved against the
harness file instead of controls-host.cjs. `tests/remediation.cjs` and
`tools/measure-controls.cjs` now resolve host-relative imports with createRequire;
the latter's WebContents double also implements isLoadingMainFrame. No assertion was
removed or weakened. Final runtime and complete native-host suites then passed. The
initial aggregate exit was 1; do not represent it as an uninterrupted passing command.
Repeating the successful ten-minute fixture suite for a harness-only resolution fix
was unnecessary. The final native suite exercised the completed handoff correction.

Logs: `test-results/keyboard-integration-20261108.log`, `keyboard-runtime-final.log`,
`keyboard-host-final.log`, and the final callback-cleanup rechecks
`keyboard-runtime-completion.log` / `keyboard-host-completion.log`. The fixture output override used the new isolated
`test-results/runs/keyboard-integration-20261108` directory; older run evidence was not
cleared. The [visual index](../test-results/visual-evidence/2026-11-09T04-16-42-204Z-24260/index.md)
records 31 scenarios, overall passed, coverage unavailable where environment-specific
native pixel comparisons were not enabled. Twelve Chromium goldens, four native
composition scenarios and the existing transition matrix passed. This does not claim
new native golden-comparison coverage or hosted CI success.

## Authenticated current-frontend check

Used only the existing isolated live-review root, blank home and its current native
navigation. Visible Log out confirmed authentication; no user participation/sign-in
was requested, no production profile accessed or copied, and no account content edited.
Fresh raw CDP diagnostics avoided the Playwright focus emulation used in earlier reviews.
No authenticated renderer was crashed or destroyed.

At 680 DIP, all four boundary transitions passed with distinct final trusted/remote
document focus, visible focus indicators and viewport-contained destinations:

- Close + Tab entered the first native destination (an anchor, not a forced composer).
- Shift+Tab from that destination returned to Close.
- Shift+Tab from the trusted first toggle entered the last native destination.
- Tab from that last native destination returned to the trusted first toggle.

Enter opened the native drawer and Escape restored the trusted toggle. Native Search
opened through the rail; five forward and five reverse Tabs retained remote focus,
ending at the dialog's input. Native rail Library activation left home, and boundary
traversal continued afterward. Its native current-selection flag was not asserted;
this milestone does not reclassify Library/project selection compatibility.

Ordinary reload confirmed a new installed document and ready host after approximately
5625ms, then forward/reverse boundary checks passed again. A temporary review-only
marker distinguished the new document from the previous ready state and disappeared
on reload. Initial 2.5-second and immediate-old-document samples were insufficient;
they are explicitly unverified in the evidence, not product failures or passing reload
coverage. One transitional drawer sample reported both documents focused; that row
does not establish exclusive native focus ownership. The completed automated host
tests use authoritative webContents.isFocused(), and the settled live boundary samples
were exclusive. Screen-reader behavior was not certified.

[Live evidence index](../test-results/live-audits/keyboard-accessibility-20261108/index.md)
contains sanitized numerical records and four inspected images. Three remote captures
are 680×810 and hide text/media; the trusted capture is 680×40 and shows the toggle's
focus outline. No raw private titles, content, URLs, credentials or DOM dumps were
retained. The final masked remote first-destination image and native Search image
confirmed expected fixture-free states. These are separate view captures, not a new
full-window golden comparison.

The [new native test composition](../test-results/runs/startup-FZ8Iik/keyboard-composition.png)
was also inspected: 1280×700, exact window source ID, 40-DIP controls, remote y40 and a
fully visible destination outline. An earlier artificial fixture button lay partly
below the viewport; the test fixture was corrected and assertions strengthened to
require viewport bounds. No production styling or screenshot tolerance changed.

Final cleanup removed review masks and marker, verified the installed runtime, and
closed through the existing trusted Close action. Port9223 no longer listened. The
authenticated profile and all historical evidence remain available.

## Scope, limits and delivery

K-01 is corrected for the tested native-host and authenticated boundary scope.
Full assistive-technology coverage, arbitrary future native focus structures and all
embedded/closed-shadow variants are not independently certified. Native modal state
remains authoritative; non-ChatGPT or unready documents retain conservative local behavior.
No general keyboard-forwarding service or independent native focus model was added.

Task-owned files: `WindowHost/controls-host.cjs`, `WindowHost/keyboard-traversal.cjs`,
`tests/startup.cjs`, `tests/remediation.cjs`, `tools/measure-controls.cjs`, `README.md`,
`docs/ARCHITECTURE.md`, this report and `docs/DEVELOPMENT_STATUS.md`. Changes remain
local and are committed for review; the pre-existing physical-validation report is
excluded and retains SHA-256 `DCC74459C5F4B946CB7ED44D5F5821533AFD0E7F008F9B5371F7C5957182314E`.
Accepted implementation branches and artifact-probe branch were preserved. No push,
PR, merge, release, deployment or branch deletion.

No hosted workflow or physical release acceptance is claimed. Physical certification
is deferred and does not block unrelated feature work; see
[development status and four proposed features](DEVELOPMENT_STATUS.md).
