# Windows release validation — 2026-11-06

**Geometry correction update:** RV-01 is now resolved locally; [section G](#g-geometry-correction-follow-up) supersedes its original unresolved status and placement gate. The original validation record below is preserved. Release readiness remains **CONDITIONALLY READY**.

## A. Environment and scope

**Recommendation: CONDITIONALLY READY.** No confirmed P0/P1 defect was established. Exact saved-placement round trips failed (P2, RV-01), and essential physical hardware, snapping, and prolonged interactive checks remain outstanding. This is not full Windows release acceptance.

The accepted baseline is `main`, `2e23044c3277fbe309069aff08fd2b768512d45f`. The working tree was clean at entry. This validation did not change application code, dependencies, snapshots, production configuration, profiles, or display settings. Nothing was committed, pushed, merged, tagged, packaged, or published.

| Item | Observed environment |
| --- | --- |
| OS | Windows 11 Home, 10.0.26200, build 26200; interactive desktop |
| External Node | 22.23.2 |
| Electron | 44.10.0; embedded Node 24.22.1; Chromium 152.0.7977.169 |
| GPU devices | NVIDIA GeForce RTX 3070, driver 32.0.16.2101; Intel UHD Graphics 770, driver 31.0.101.5592 |
| GPU features | Electron reported accelerated compositing, canvas, rasterization, WebGL, WebGPU, and video decode/encode enabled; direct rendering display compositor disabled/off-ok |
| Primary desktop | `DISPLAY10`: 1920×1080, origin (0,0), work area (0,0,1920,1032), 100% / 96 DPI |
| Secondary desktop | `DISPLAY11`: 1920×1080, origin (1920,0), work area (1920,0,1920,1080), 100% / 96 DPI |
| Physical identification | WMI reported SHARP HDMI, Acer H233H, and VG279QM monitor devices. Their mapping to the two desktop surfaces was not established. No serial numbers retained. |
| Relevant production settings, read only | 550×1010; start maximized false; remember placement true; fading enabled; inactive opacity 50% |
| Isolated settings | 680×850; remember placement true; fading enabled at 50%; history/title recording disabled; separate loopback port |

**Evidence categories:** these were real Electron HWNDs on the OS-visible desktop, with synthetic offline content and disposable profiles. They were not simulated BrowserWindow objects. However, the physical-versus-virtual mapping of the desktop surfaces was not verified; this report does not claim physical two-monitor acceptance. The automated fixture's page-zoom cases are not Windows display-DPI tests. No authenticated production profile was opened or copied.

An initial inventory provider reported a negative secondary origin and different primary assignment. Subsequent WinForms, Electron, and inventory readings agreed on the positive-origin layout above. No display settings were changed by this task. The discrepancy remains an environment limitation; it provides no evidence for negative-origin handling or a physical topology transition.

### Evidence retained locally

Disposable, ignored evidence is under `test-results/runs/release-validation-20261106-163501/`:

- `driver.cjs`, `observe.ps1`, `actions.jsonl`, `native-samples.jsonl`, `native-displays.json`, and `observation-summary.json`: initial isolated session and passive native measurements.
- `recovery.cjs` and `recovery-events.json`: fresh automated integration run, explicitly distinct from physical mouse/keyboard acceptance.
- `placement.cjs` and `placement-events.json`: three-cycle reproduction of RV-01.
- `cleanup-verified.json`: task-process cleanup verification.

The focused existing native-host test produced synthetic renderer captures under `test-results/runs/native-host-rehPMm/`. These local artifacts are not included in the release or committed with this report. The report's measured values and reproduction steps remain usable without them.

## B. Validation matrix

PASS applies only to the scope named in each row. BLOCKED and NOT TESTED do not count as PASS.

| Test | Environment / method | Result | Evidence and limits |
| --- | --- | --- | --- |
| Launch on primary | Fresh isolated Electron; (100,90), 680×850 | PASS | `recovery-events.json`, initial event; synthetic page only |
| Move between desktop surfaces | Automated `BrowserWindow.setBounds`, x=2020 then x=100 | PASS | Maximize/restore observations on both OS-visible surfaces; no claim of physical dragging or DPI transition |
| Physical cross-monitor dragging | Computer-use helper | BLOCKED | Helper rejected a drag endpoint outside the target window's bounds; no cross-monitor drag occurred |
| Border resize and title-bar drag | Existing focused native-host test; guarded desktop input | PASS | `Drag` and `Resize` assertions passed; no mixed-DPI coverage |
| Maximize/restore on both surfaces | Real caption IPC in automated run; additional pointer interaction on secondary | PASS | Primary maximized outer bounds (-8,-8,1936,1048); secondary (1912,-8,1936,1096); both restored to their original 680×850 bounds. Invisible frame margins explain outer maximized overscan. |
| Minimize/restore | Automated native window action | PASS | Minimized state asserted, then restored to valid bounds; taskbar restore not exercised |
| Close/relaunch and exact placement | Real server persistence, fresh launches | FAIL | RV-01: saved invisible borders accumulate into restored dimensions/position |
| Unavailable saved location | Synthetic state x=99999, y=-99999 | PASS | Recovered to (3160,0), 680×850, within secondary work area; physical unplug/reconnect not exercised |
| Primary assignment change | Physical settings | NOT TESTED | Desktop settings left unchanged |
| Negative-origin monitor | Physical layout | NOT TESTED | Conflicting initial inventory is not acceptance evidence |
| Mixed DPI / resolution transitions | Target configurations A–C | NOT TESTED | Available desktop surfaces both reported 1920×1080 / 100%; no scaling changes made |
| Monitor disconnect/reconnect | Physical hardware | NOT TESTED | Synthetic off-screen recovery above does not substitute for this |
| Edge, left/right, quarter snapping; repeated snap/unsnap | Windows shell | BLOCKED | Cross-window drag restriction; Windows-key automation prohibited by computer-use guidance |
| Move snapped window between monitors | Windows shell | NOT TESTED | Depends on outstanding snapping/hardware checks |
| Snap Layout hover | Existing custom HTML caption | NOT TESTED | Native maximize hover menu is an existing documented limitation, not a newly established regression; see [Known limitations](KNOWN_LIMITATIONS.md) |
| Win+Z / Win+Arrow | Windows shell | BLOCKED | Computer-use guidance: “Do not use the Windows key or shortcuts involving the Windows key.” Manual check required |
| Alt+Space system menu | Physical keyboard input to isolated HWND | PASS | Menu visibly displayed with Move, Size, Minimize, Maximize, and Close; dismissed with Escape |
| Caption maximize/restore, minimize, close, double-click title bar | Existing focused native-host test | PASS | Guarded native input assertions passed; initial separate helper session had input interference, described below |
| Narrow/wide header and controls | Existing focused host fixture test | PASS | 390/480/680/1280 DIP at page zoom 100/125/150%; minimum width 390; control and layout assertions passed. This is synthetic content, not a renewed authenticated-site review. |
| Taskbar restore | Windows shell | NOT TESTED | Explicit manual requirement |
| Caption Pin on/off | Fresh automated real Electron run | PASS | Four sequential local caption IPC actions produced native/ARIA true, false, true, false; existing focused native-host test also passed |
| Caption Pin under computer-use helper | Physical helper session | BLOCKED | Intermittent state disagreement and overlapping-window input rejection; U-01 below. Full physical acceptance remains open. |
| One pinned / one unpinned; independent alpha | Initial desktop session plus passive Win32 reads | PASS | Mixed alpha 128/255 observed in 16 samples; limited duration and helper interference prevent sustained acceptance |
| Two pinned windows | Isolated HWNDs, native loopback operations | PASS | Both topmost and alpha 128 in five samples; automated recovery run also observed two topmost windows. External loopback mutations do not establish caption ARIA synchronization. |
| Rapid unpin/repin | Automated real loopback sequence, three cycles | PASS | Both intended native topmost states retained; whole-window alpha restoration also passed the existing focused runtime test. Not an exhaustive physical rapid-click test. |
| Repeated opacity setting enable/disable | Isolated configuration | NOT TESTED | Still required during the manual prolonged session |
| Focus and pointer entry/exit | App/neutral task-owned windows | PASS | Alpha 128 and 255 observed, with foreground/pointer samples. Pure inactive hover and all boundary gestures were not exhaustively exercised. |
| Minimize/restore while pinned | Prolonged physical interaction | NOT TESTED | Normal minimize/restore above does not establish this scenario |
| Destroy one pinned window; survivor | Automated fault injection, same isolated app | PASS | Forced `BrowserWindow.destroy()` left the other native window pinned and usable; this is not an independent renderer-process crash test |
| Close final window / restart Pin state | Isolated automated close/relaunch | PASS | Final caption Close exited; fresh launches were unpinned. Multiple windows and Pin state are not restored as a session. |
| Approximately 30-minute active multi-window session | Physical input | BLOCKED | Only 18m07s of passive sampling, interspersed with diagnosis/interactions, was collected. Two windows were sampled for only part of that period; no 30-minute active-session acceptance claimed. |
| Abrupt Electron termination / restart | Task-owned main process PID, disposable profile | PASS | Main PID killed, fresh launch succeeded without profile cleanup; config dimensions remained 680×850. Restored geometry showed RV-01. |
| Abrupt control-server termination / restart | Task-owned child, isolated port/root | PASS | Replacement server started and discovered surviving pinned window; no ownership guard weakened. Restart was explicitly initiated by the harness, not automatic recovery. |
| Duplicate service attempt | Same isolated port/root | PASS | Duplicate invocation exited 0; original service continued responding |
| Foreign HWND/PID binding | Neutral task window | PASS | Rejected with HTTP 409; no mutation performed |
| Stale/incidental process ownership | Existing targeted remediation tests | PASS | Incidental arguments rejected and creation-time/identity revalidation covered; supported shell test terminated only its own disposable sleeper. No production metadata or processes used. |
| Normal closure and repeated launch | Automated run | PASS | Final caption closure and two subsequent launch/close cycles succeeded; no manual profile cleanup |
| Cleanup | Process executable/command-line inventory | PASS | No remaining processes from task fixture roots after final checks; no desktop settings needed restoration |

### Observation and performance limits

There were 215 native samples from 16:38:21 to 16:56:28 Pacific (18m07s). Sampling was approximately every five seconds; the task driver also queried Electron state approximately twice per second. These add measurement overhead. The sample contained 74 two-window observations and only five observations with both windows pinned and dimmed. It cannot establish prolonged multi-window stability, smoothness, or absence of a leak.

| Process / interval | CPU seconds / wall seconds | Mean of one logical core | Private memory, first → last (peak) | Handles, first → last |
| --- | --- | --- | --- | --- |
| Electron main, 18m07s | 34.89 / 1086.8 | 3.21% | 41.4 → 53.3 MiB (53.5) | 1133 → 1270 |
| Initial control server, 13m53s before fault injection | 23.58 / 832.6 | 2.83% | 90.7 → 96.2 MiB (96.3) | 751 → 797 |
| Neutral task window, 18m07s | 2.64 / 1086.8 | 0.24% | 38.0 → 40.4 MiB (40.4) | 1046 → 1049 |

The Electron interval includes adding a second window and diagnostic activity. These are per-process measurements, not total application/GPU CPU or a steady-state leak test. Maintenance/opacity write counts were not instrumented; no claim is made that redundant writes were remeasured or eliminated in this session. Prior synthetic benchmark improvements remain prior evidence.

## C. Findings

### RV-01 — P2: saved placement grows and shifts on relaunch

**Confirmed, unresolved; recoverable positioning defect.** At 100% DPI, each fully persisted launch/close cycle added 16 pixels to width and eight to height and shifted x eight pixels left. The window remained accessible. No P0/P1 impact was demonstrated.

Reproduction, using only an isolated fixture root:

1. Enable `rememberWindowPlacement`; seed isolated saved state to (100,90), 680×850, normal state.
2. Launch the supported fixture host with `Get-AppModeWindowArgs` output. Focus its window and wait at least 3.6 seconds for normal server persistence.
3. Inspect the task-only saved state, close normally, and relaunch using the saved arguments.
4. Repeat. Observed launch → save values:

| Cycle | Actual Electron normal bounds (x,y,w,h) | Saved state (x,y,w,h) |
| --- | --- | --- |
| 1 | (100,90,680,850) | (92,90,696,858) |
| 2 | (92,90,696,858) | (84,90,712,866) |
| 3 | (84,90,712,866) | (76,90,728,874) |

The established 100%-DPI cause is a geometry contract mismatch: [Save-AppModeWindowPlacement](../tools/AppMode.Windows.ps1) saves the Win32 normal-placement rectangle including invisible frame borders, while [Get-AppModeWindowArgs](../tools/AppMode.State.ps1) passes those values to Electron as its launch bounds. The native observer independently measured the same 16×8 border difference. Configuration preferences themselves remained unchanged.

Affected components: native placement capture, shared launch arguments, and Electron hidden-title-bar geometry. A correction should normalize the saved rectangle to the host's coordinate/dimension contract and preserve legacy state compatibility. It must cover normal/maximized persistence, taskbar work areas, and physical 100/125/150% scaling. No speculative conversion or architectural change was made in this validation task. The P2 can be accepted explicitly for a release or corrected in a focused follow-up; exact placement acceptance is currently failed.

### U-01 — unconfirmed: caption Pin disagreement during helper use

In the initial computer-use session, a trusted caption click and allowlisted caption IPC sometimes left native and rendered Pin false. Direct native loopback pinning worked. A temporary bounded, task-local trace observed an Electron `setAlwaysOnTop(true)` event followed by a false native read without a corresponding Electron off call. One subsequent helper click was rejected because the point was covered by an unrelated window. No unrelated window was intentionally operated.

This was not reproduced in the fresh automated run without computer-use interaction: caption native/ARIA state toggled correctly four times. The existing full native-header test also passed. Root cause is unestablished; the results do not justify an application patch or a confirmed P1 classification. They also do not justify physical Pin acceptance. Repeat caption Pin testing on an unobstructed desktop without concurrent automation before distribution; elevate to P1 if independently reproduced.

No confirmed P0/P1 finding or out-of-scope P3 change was introduced.

## D. Changes and safety

Only this report is a repository change. No application correction was made; exact placement did not pass, and its P2 remains open. Temporary drivers, fixture profiles, and diagnostics stayed under ignored task-owned run directories. No production profile, account, or configuration was modified; no display settings were changed. Task processes were closed or terminated using owned handles/PIDs, and cleanup inventory found none remaining.

An initial occluded-window capture included unrelated private content in the tool conversation. It was excluded from release evidence and was not saved into repository files, report, or task artifacts. Consequently, a blanket claim that no private content was ever captured would be incorrect. Later retained evidence uses synthetic content and numeric state only; no private text from that capture is reproduced here. This report cannot remove that earlier tool-conversation image.

## E. Regression results

Executed for this validation, all without test/snapshot changes or added skips:

```powershell
node --test --test-name-pattern="native header host preserves sandbox" tests/window-host.cjs
# 1 passed, 0 failed, 0 skipped (about 54 seconds)

node --test --test-name-pattern="native opacity applies|server process ownership|real supported shell" tests/runtime.cjs tests/remediation.cjs
# 3 passed, 0 failed, 0 skipped
```

The existing focused native-header test includes guarded real caption/title-bar/resize input and synthetic layout/navigation/security assertions. Its Pin bridge actions are programmatic; it is not a replacement for the outstanding prolonged manual session. The selected runtime opacity test used actual isolated Win32 windows. Test-name filters did not execute other tests; these four passes are not a new full-suite result.

Disposable `recovery.cjs` completed its bounded integration sequence and cleanup, including real process termination/relaunch, duplicate-window recovery, and unavailable-position clamping. `placement.cjs` completed three cycles and reproduced RV-01. Some events are recorded observations rather than individual test assertions; the matrix above is the acceptance result.

**Prior accepted evidence, not rerun or independently reverified here:** 56 visual tests, 13 local runtime tests, seven local host tests, authenticated isolated review at 390/680/1280px, and hosted Windows CI success supplied with the accepted baseline. No application code changed, so `npm run test:all` was not repeated. Any future application correction requires the full supported suite and focused native reproduction.

## F. Release recommendation and remaining acceptance

**CONDITIONALLY READY**, with the following distribution gates:

1. Complete physical monitor/DPI and Windows snapping checks below.
2. Complete an approximately 30-minute active multi-window Pin/opacity session and resolve U-01 if it reproduces without helper interference.
3. Explicitly accept RV-01 as a recoverable P2 or correct it and rerun the full suite plus native placement checks. This report does not assert exact saved-position fidelity.

No production release was created. Do not label this baseline fully validated from these results alone.

### Manual acceptance procedure

Use the repository's isolated live-review infrastructure described in [Visual testing](VISUAL_TESTING.md), never the production profile. Keep the desktop unobstructed and avoid simultaneous headed suites. Use synthetic content for captures; mask any authenticated content. Record OS/build, Electron version, each monitor's resolution/scale/origin/work area, and before/after geometry.

1. **Hardware:** use the closest available physical pair to 1080p/100% + 1440p/125%, reverse primary assignment, and if available 4K/150% + 1080p/100%. Include a negative origin. Launch on primary; drag across; resize; maximize/restore; minimize and restore from the taskbar; close after at least four seconds and relaunch. Check caption targets, 40-DIP title bar, content scale, minimum 390-DIP width, 680 and 1280 widths, overflow, sidebar and composer. Record any RV-01 drift separately from DPI effects.
2. **Unavailable monitor:** save a secondary position, close, safely disconnect that display, relaunch and verify visible usable geometry; reconnect and repeat. Restore the original display settings/topology afterward. A synthetic off-screen state does not complete this gate.
3. **Shell:** test left/right/top edges and quarters, Win+Arrow, Win+Z, repeated snapping/unsnapping, snapped cross-monitor moves, double-click title bar, caption controls, keyboard focus, border resizing, and taskbar restore. The custom maximize-hover Snap Layout menu is not implemented; check supported shell activation without treating that documented omission as a new defect.
4. **Thirty-minute session:** timestamp at least ten active checkpoints spread across the full interval, with idle gaps. Use two isolated app windows and a neutral app. Exercise one/two pinned, independent alpha, rapid pin/unpin/repin, repeated opacity enable/disable, focus switches, inactive pointer entry/exit and borders, scrolling/dragging, pinned minimize/restore, closing one pinned window, then the final window and relaunch. Confirm native topmost and alpha 255/approximately 128 at 50%, caption state, responsiveness, and absence of persistent topmost after unpin. Record transitions and resource samples; do not infer leak freedom from a short interval.
5. **Recovery follow-through:** on the same physical setup repeat task-owned Electron/server termination and restart, verifying visible geometry and expected unpinned fresh windows. Capture only task process identity/creation-time results, not unrelated command lines. Verify cleanup and settings restoration.

Record PASS/FAIL with masked captures or numeric geometry/alpha evidence for each outstanding row. Reclassify any independently reproduced Pin failure or inaccessible window as P1; do not patch around ownership or security guards.

## G. Geometry correction follow-up

**RV-01: RESOLVED locally, uncommitted.** Baseline remains `main` at `2e23044c3277fbe309069aff08fd2b768512d45f`. Verification completed 2026-11-06 Pacific (2026-11-07 UTC). The historical findings and original test results above have not been replaced.

### Reproduction and root cause

A fresh isolated baseline run used the actual control-server placement writer, shared PowerShell launch arguments, real Electron windows, and eleven launches (initial plus ten relaunches). The test used the repository's guarded fixture activation helper to establish foreground ownership before the server's three-second sample. An initial attempt without foreground activation did not capture new state and was excluded from the drift comparison. Measurements included Electron bounds, content bounds, normal bounds, scale factor, work area, and persisted JSON. No desktop screenshot was needed.

The lifecycle was: saved JSON → `Get-AppModeWindowArgs` → `safeBounds` → hidden-title-bar BrowserWindow → foreground server sample → Win32 `WINDOWPLACEMENT.normal` → saved JSON. At 100%, the Win32 rectangle included invisible nonclient margins absent from Electron's bounds contract. Passing that larger rectangle back into Electron added another 16×8 and shifted x left eight pixels on every cycle. Bounds validation and work-area clamping did not cause those increments.

Fractional-scale tests exposed a second startup effect: Windows hidden-frame construction/first-show rounding could also be mistaken for a user resize. Merely changing the writer to `getNormalBounds()` still accumulated geometry under emulated 125%. These intermediate versions failed the strict regression test; its assertions were retained.

### Corrective implementation

- `WindowHost/placement.cjs` captures the owning Electron window's normal rectangle in screen DIPs, without translating Win32 workspace coordinates or subtracting fixed margins. It preserves normal geometry through maximize/restore, skips minimized/fullscreen capture, and respects the current `rememberWindowPlacement` setting. Settled foreground geometry events and a three-second fallback sample save state; normal close flushes the final state. Identical state is not rewritten. Writes replace the JSON atomically using a process/window-specific temporary file; failures leave a fixed diagnostic and clean up that temporary file. Timers are cleared when the window closes.
- `WindowHost/main.cjs` applies the validated initial rectangle with Electron's `setBounds` after native frame creation and before showing. The persistence helper retains that requested rectangle when the window still matches its first-show normal rectangle. Native startup rounding is therefore not fed into later launches as a user change; a subsequent actual move/resize captures its new normal rectangle. This uses matching Electron APIs and no hardcoded frame offsets or scale multiplication. See Electron's [window API](https://www.electronjs.org/docs/latest/api/browser-window) and [screen coordinate documentation](https://www.electronjs.org/docs/latest/api/screen).
- The server no longer writes Win32 placement over Electron state. Its Pin, opacity, ownership, retention, and network behavior are unchanged.
- New state retains `x`, `y`, `width`, `height`, and `maximized`, adding `coordinateSpace: "electron-dip"`. `Get-AppModeWindowArgs` forwards marked DIP values to Electron's existing display-aware validation/clamping rather than applying WinForms physical-screen limits first. Valid unmarked legacy state still loads using the existing compatibility path. Previously accumulated dimensions are not guessed at or silently subtracted; configuration preferences are not rewritten.

The screenshot supplied during this correction also identified a directly related shutdown race: a late `page-title-updated` callback called `setTitle` on a destroyed window. Title and completed-load callbacks now check object lifetime before accessing the owning window/view. A regression delivers both callbacks after destroying the fixture window; no global exception suppression was added.

### Actual before/after measurements

Both series started at **(x=100, y=90, width=680, height=850)** and reused each preceding run's saved state without resetting between launches. Values below are cumulative changes from that series' initial launch, in DIPs at 100% scale.

| Relaunch | Before Δwidth | Before Δheight | Before Δx | Before Δy | After Δwidth | After Δheight | After Δx | After Δy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | +16 | +8 | -8 | 0 | 0 | 0 | 0 | 0 |
| 2 | +32 | +16 | -16 | 0 | 0 | 0 | 0 | 0 |
| 3 | +48 | +24 | -24 | 0 | 0 | 0 | 0 | 0 |
| 5 | +80 | +40 | -40 | 0 | 0 | 0 | 0 | 0 |
| 10 | +160 | +80 | -80 | 0 | 0 | 0 | 0 | 0 |

At relaunch ten the baseline was **(20,90,840,930)**; the corrected application was **(100,90,680,850)**. All ten corrected saved rectangles matched the restored rectangle exactly, including the initial valid legacy-state transition.

| Additional check | Actual result |
| --- | --- |
| Move/resize and relaunch | (240,100,730,620) restored exactly |
| Maximize, close, relaunch, restore | Relaunched maximized; normal rectangle remained (240,100,730,620) |
| Minimized close / fullscreen close | Previous saved normal geometry was not overwritten |
| 390×300 minimum at 100% | Stable through three further launches |
| Emulated 125%, minimum-size sequence | Actual first rectangle (100,100,393,301); identical at every one of ten relaunches |
| Emulated 150%, minimum-size sequence | Actual first rectangle (100,100,391,301); identical at every one of ten relaunches |
| Oversized unavailable-position state | Recovered within an available Electron work area |
| Synthetic negative-origin work area at scale metadata 1/1.25/1.5 | Off-screen/oversized states clamped; repeated DIP round trips stable |

The emulated minimum rectangles show a bounded first-show native frame/minimum-size difference from the requested 390×300. It does not accumulate, and the saved requested rectangle is retained until an actual geometry change. Emulation and synthetic work areas do **not** establish physical mixed-DPI acceptance, physical snapping, or monitor disconnection behavior.

### Executed regression verification

- `node --test --test-concurrency=1 tests/geometry.cjs`: final focused run **2 passed, 0 failed, 0 skipped**, including ten relaunches at each scale, valid legacy state, move/resize, maximize/restore, minimize, fullscreen, minimum size, off-screen recovery, persistence disabled, unchanged-write suppression, and callbacks after destruction.
- `npm run test:all`: **56 visual + 13 runtime + 9 host passed**, no skips. The host phase includes the new two geometry checks and the existing guarded native caption, Pin, dragging, resizing, navigation, and sandbox checks. After the full suite, only the new test's initial seed was aligned with the original reproduction rectangle; the final focused run above verified that seed. Application code did not change after the full suite.
- No snapshots, dependencies, security guards, or test skips were changed. No hosted CI was run or claimed for these uncommitted changes.

Final local numeric evidence is `test-results/runs/geometry-host-OUReVK/measurements.json`; the full-suite geometry run is `test-results/runs/geometry-host-YGnpOt/measurements.json`. Logs are `test-results/runs/geometry-final.log` and `test-results/runs/geometry-regression.log`. Playwright clears its configured disposable output directory `test-results/runs` at suite startup; earlier raw run paths in this report are historical and were cleared by that cleanup. The before values above were recorded from the baseline's console/numeric output before cleanup. The report and persistent live-review directories were preserved.

### Files and release status

Changed application files: `WindowHost/main.cjs`, new `WindowHost/placement.cjs`, `Start-ChatGPT-TopMostServer.ps1`, and `tools/AppMode.State.ps1`. Coverage: new `tests/geometry.cjs` and its registration in `package.json`. Documentation: this preserved report, the placement description in `docs/ARCHITECTURE.md`, and `docs/KNOWN_LIMITATIONS.md`.

**CONDITIONALLY READY remains the recommendation.** The original RV-01 correction gate is satisfied by these local results. Physical multi-monitor/mixed-DPI transitions, Windows snapping/taskbar behavior, and the full 30-minute interactive multi-window Pin/opacity session (including U-01 follow-through) remain separate release requirements. No production profiles or display settings were changed. Final process inventory found no remaining task-owned geometry or native-header fixture processes. All edits remain local and uncommitted; nothing was pushed, merged, tagged, deployed, or published.

## H. Final Physical Windows Acceptance

**2026-11-06 Pacific — partial acceptance; CONDITIONALLY READY.** The user performed the physical interactions. No automated desktop clicks, keypresses, or window activations were issued in this phase. Read-only numeric sampling accompanied the isolated fixture windows. The user deferred the 30-minute session, so this section does not claim completed final physical acceptance. Sections A–G remain preserved as historical evidence.

### H1. Hardware environment

| Item | Evidence |
| --- | --- |
| Baseline | `main`, `2e23044c3277fbe309069aff08fd2b768512d45f`, with the nine existing local geometry-correction/report files preserved |
| Windows / Electron | Windows 11 Home 10.0.26200, build 26200; Electron 44.10.0, embedded Node 24.22.1 |
| Physical primary | VG279QM, confirmed by the user; Electron label VG279QM, reported refresh 240 Hz |
| Physical right monitor | Acer H233H, explicitly confirmed by the user as the physical screen displaying Neutral; Electron label Acer H233H, reported refresh 60 Hz |
| Desktop geometry reported by APIs | Both 1920×1080; primary origin (0,0), work area (0,0,1920,1032); right origin (1920,0), work area (1920,0,1920,1080) |
| Scaling uncertainty | APIs reported factor 1.0 / 96 DPI. The user's Windows Settings screenshot showed pre-existing custom scaling at 175%, with the standard Scale dropdown disabled. Effective physical scaling cannot be established from these conflicting readings. |
| Other device metadata | WMI also listed SHARP HDMI; it was not mapped to an acceptance desktop and was not used to claim additional physical-monitor coverage. |
| GPUs reported | NVIDIA RTX 3070 driver 32.0.16.2101; Intel UHD Graphics 770 driver 31.0.101.5592 |

The user confirmed the custom scaling was already present before this test. It was left unchanged; nobody signed out. Turning custom scaling off would require a disruptive sign-out, so that was not attempted. Initial Ctrl+wheel actions changed page zoom, not Windows display scale, and were excluded from mixed-DPI acceptance. Therefore even the APIs' reported 100%/100% configuration is not claimed as verified physical 100% scaling.

This phase used actual desktop windows on the two user-confirmed physical monitors, with synthetic offline content, a fresh task-owned profile, and a dedicated isolated control server. No forced display-scale emulation was used. Physical monitor identity is now better established than in section A, while effective scaling remains unresolved. The synthetic page does not establish authenticated-site sidebar/composer compatibility.

### H2. Multi-monitor/DPI results

| Scenario / interaction | Result | Actual evidence and limits |
| --- | --- | --- |
| Physical primary → secondary movement at the existing configuration | PASS | User manually moved A from its initial primary position to the Acer. Numeric bounds changed from (80,80,680,800) to (1953,132,680,800); no scripted `setBounds` move was used. |
| Physical window resizing | PASS | Numeric observations included A changing to 823×470 and B to 680×538, then 390×791. The user performed the interactions. Sampled caption height remained 40 DIP and sampled document overflow remained false. This is fixture-layout evidence. |
| Normal close/relaunch on secondary | PASS | User reported B on primary and A on secondary, then both relaunched at A's last-closed position. The real shared saved-geometry helper supplied (1953,132,680,800), and A restored exactly. |
| Separate A/B saved positions | Not an acceptance requirement | One placement is stored per installation, not per window identity. The harness deliberately applied the same saved arguments to both new windows. Their overlap was expected and did not reproduce RV-01. |
| Scenario A: verified physical 1080p/100% + 1080p/100% | NOT TESTED | Physical pair and resolution verified, but API scale 1.0 conflicts with the pre-existing custom 175% setting. No definite effective-scale claim. |
| Scenario B: physical mixed 125% | BLOCKED | Custom scaling disabled the standard per-display Scale dropdown; sign-out was avoided. Page zoom was not substituted. |
| Scenario C: physical mixed 150% | BLOCKED | Same limitation; no physical 150% result claimed. |
| Scenario D: different resolutions/scales | NOT TESTED | No resolution change or confirmed physical scale transition performed. |
| Scenario E: negative-coordinate physical arrangement | NOT TESTED | Original topology left unchanged. Earlier synthetic negative-origin results remain separate. |
| Scenario F: disconnect/disable/reconnect secondary | NOT TESTED | No monitor was disabled or disconnected. Earlier synthetic off-screen recovery remains separate. |
| Repeated persisted relaunches across real scale transitions | NOT TESTED | No real scale transition completed. Section G's corrected repeated-launch results remain valid prior evidence, not physical mixed-DPI evidence. |

### H3. Windows shell results

The initial broad checklist was replaced by a simpler six-step checklist. At **18:45:51 Pacific**, the user reported **“all six passed.”** That statement applies only to these six steps:

| User-performed check | Result |
| --- | --- |
| Win+Left: A snaps into the left half | PASS |
| Win+Up from that state: A reaches the upper-left quarter | PASS |
| Win+Z: layout menu appears and a layout can be selected | PASS |
| Double-click empty title-bar region to maximize, then double-click to restore | PASS |
| Caption Minimize, then restore A using its taskbar preview | PASS |
| Alt+Space opens the system menu; Escape dismisses it | PASS |

Numeric sampling also observed maximized and minimized states. The user's direct report is the evidence for the complete input/result sequence, since five-second polling cannot capture every brief transition. All sampled caption surfaces remained 40 DIP high; no sampled document horizontal-overflow flag was true.

The following broader checks were not explicitly completed/attested and remain **NOT TESTED**: right-half and every other quarter individually; deliberate repeated snap/unsnap cycles; drag-to-top maximize; moving an already snapped window between monitors; verifying snapped-border resizing; caption maximize/restore separately from title-bar double-click; and close/relaunch after snapping to verify persisted snapped geometry. Numeric resizing alone does not prove a window was snapped during that resize. The documented absence of a native maximize-hover Snap Layout menu was not treated as a new defect.

Windows-key actions were performed by the user. The installed computer-use guidance prohibits the agent from issuing Windows-key shortcuts; no alternate automation was used to bypass that restriction.

### H4. Pin/opacity endurance results

**Formal endurance result: NOT TESTED / deferred by user.**

- Start timestamp: **none**; the Start session control was never activated.
- Finish timestamp: **none**.
- Continuous active endurance duration: **0 minutes**.
- Recorded active endurance checkpoints: **0**.
- The user stated that a 30-minute session was not possible now. Setup, troubleshooting, page-zoom actions, and the short shell check were not counted toward it.

There were **252 passive samples**, from **18:24:33 to 18:45:48 Pacific** (approximately 21m15s), covering setup and incidental short interactions. This was not a deliberate 30-minute session. No checkpoint PASS was inferred from elapsed time.

| Incidental observation, outside endurance | Numeric result |
| --- | --- |
| Initial normal windows | Both native topmost false, caption Pin false, alpha 255 |
| A pinned / B unpinned, e.g. 18:39:42 | A native/caption true, alpha 128; B native/caption false, alpha 255 |
| Both pinned before cleanup, 18:45:48 | Both native/caption true and inactive alpha 128 |
| Pointer/focus changes | Alpha 128 and 255 observed during the passive sample period |
| Shell transitions while Pin was on | Sampled Pin/caption agreement continued; user reported the six shell checks passed |

Repeated fade-setting enable/disable, deliberate rapid Pin/unpin/repin sequences, systematic independent-state reversal, closing one pinned window and exercising its survivor, and final pinned-close/relaunch were not accepted as completed endurance scenarios. No explicit user attestation established all required visible stacking outcomes.

Lightweight resource observations below are per process and include setup/input activity and sampling overhead. The Electron row covers the relaunched main process, not a single unbroken application lifetime or all renderer/GPU usage.

| Process / measured interval | CPU seconds; average of one logical core | Private memory first → last (peak) | Handles first → last |
| --- | --- | --- | --- |
| Relaunched Electron main, 1168s | 16.89s; 1.45% | 47.8 → 49.6 MiB (50.3) | 1210 → 1241 |
| Isolated server, 1274.6s | 26.05s; 2.04% | 90.7 → 92.2 MiB (92.2) | 750 → 800 |
| Neutral app, 1274.6s | 8.17s; 0.64% | 36.2 → 37.7 MiB (38.3) | 1041 → 1030 |

These values do not demonstrate long-term leak freedom, sustained workload stability, animation smoothness, or redundant-write suppression. No permanent instrumentation was added to application code.

### H5. U-01 follow-up

**U-01 remains unconfirmed and uncleared.** The new short observations used manual caption interactions without competing automated desktop input. Settled native/caption states agreed, including one-pinned/one-unpinned and both-pinned observations.

Two transient disagreements were sampled: A at **18:38:11** and B at **18:41:44**, each showing native topmost true with the cached caption reading false. Each agreed again at the next approximately five-second sample (18:38:16 and 18:41:49). Caption values and native state were collected asynchronously, so those samples cannot distinguish sampling skew from a short rendered-state delay. They did not establish a persistent application failure or reproduce the earlier sustained symptom confidently.

Visible stacking agreement was not explicitly attested across the required Pin sequences, and the planned prolonged session did not begin. Therefore these observations neither conclusively reproduce U-01 nor establish its elimination. Complete the unobstructed three-way caption/native/visible-stacking comparison during the future endurance session; escalate an independently reproduced normal-interaction failure to a potential P1.

### H6. Defects and evidence

No new confirmed P0/P1 defect was established. The shared A/B launch position was expected single-placement behavior. The custom-scaling/sign-out constraint is an environment blocker, not an application defect. No speculative application correction was made.

Local ignored evidence is under `test-results/runs/physical-acceptance-20261106-182117-live/`: `events.jsonl`, `status-samples.jsonl`, `native-samples.jsonl`, `final-state.json`, `observation-summary.json`, `resource-summary.json`, and `cleanup-verified.json`. The disposable driver and read-only samplers are retained there. Their neutral control panel was a task-local test aid, not an application feature. Earlier setup artifacts remain under the adjacent directory without `-live`.

No new desktop screenshots were captured by the agent. The user-supplied scaling screenshot was used only to identify the custom-scaling constraint; no private account/profile content was copied into evidence. Production profiles, configuration, and unrelated windows/processes were not operated. No display setting was changed, and no sign-out was performed.

### H7. Release recommendation

**CONDITIONALLY READY.** Physical monitor identity, manual cross-monitor movement/resizing, a saved-placement relaunch, and the six manual shell checks now have additional evidence. The application is not fully physically accepted.

Outstanding acceptance requirements:

1. Physical mixed-DPI transitions and persisted restoration at confirmed effective scale factors. Resolve the pre-existing custom-scaling constraint in a separately planned session; do not sign out merely to complete this report. Include negative-origin/disconnect and broader resolution cases where safe and available.
2. Remaining shell cases listed in H3, especially snapped cross-monitor movement and persisted snapped geometry.
3. A fresh, approximately 30-minute deliberate two-window Pin/opacity session with at least ten timestamped active checkpoints, including visible stacking, rapid transitions, opacity-setting changes, pinned minimize/restore, and multi-window lifecycle. Finish the U-01 comparison there.

The 56 visual / 13 runtime / 9 host passes in G remain prior evidence for the unchanged local correction. The full suite was not rerun for this documentation/physical-validation phase. All nine pre-existing files matched their entry SHA-256 hashes before appending this section; only `docs/RELEASE_VALIDATION.md` changed during this phase. Final cleanup inventory at **18:46:56 Pacific** found no remaining task-owned app, neutral, server, driver, or sampler processes. Original display settings were retained. The eight other correction/documentation/test files remain byte-identical to their entry state. Branch and HEAD remain `main` at `2e23044`; all changes remain local and uncommitted. Nothing was committed, pushed, merged, tagged, packaged, or deployed.

## I. Development-baseline commit follow-up

The geometry persistence and destroyed-window callback corrections, with their regression coverage, were committed as `01a9d87`. The architecture, known limitations, and historical acceptance evidence are committed separately with this follow-up. Statements in A–H about local/uncommitted work describe the state at those validation checkpoints.

The release recommendation remains **CONDITIONALLY READY**. Committing and pushing establish a development baseline, not production-release approval. Verify hosted Windows CI against the exact pushed tip before adopting it as the new stable development baseline. Physical mixed-DPI acceptance, the remaining shell cases in H3, the 30-minute Pin/opacity session, and U-01 follow-through remain outstanding.
