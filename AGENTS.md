# ChatGPT App Mode — Agent Instructions

## 1. Purpose

These instructions apply to AI coding agents working on the ChatGPT App Mode repository.

Priorities, in order:

1. Complete the user's requested task.
2. Preserve existing functionality and security.
3. Minimize unnecessary code changes.
4. Use efficient, risk-appropriate verification.
5. Avoid excessive reasoning, tool calls, and repeated work.

Use the smallest reliable implementation that satisfies the request.

Do not expand task scope without a concrete technical reason.

---

## 2. Project Architecture

ChatGPT App Mode is a Windows desktop application using PowerShell and Electron.

Key components:

- `Launch-ChatGPT-AppMode.ps1` — Application launcher.
- `WindowHost/` — Electron host, native window controls, and security.
- `extension/` — ChatGPT page styling and JavaScript overrides.
- `Start-ChatGPT-TopMostServer.ps1` — Local window-control service.
- `Start-ChatGPT-TrayLauncher.ps1` — System tray integration.
- `TaskbarLauncher/` — Windows taskbar integration.
- `tools/` — Shared application and PowerShell utilities.
- `tests/` — Automated verification.
- `docs/` — Architecture and development documentation.

Electron is the supported browser runtime.

The host uses a dedicated browser profile under:

`Browser/AppModeHostProfile`

The Electron host injects the shared CSS and JavaScript overrides into trusted ChatGPT pages.

Read the relevant implementation files before editing. Consult architecture documentation only when the task requires it.

Do not repeatedly inspect unrelated components.

---

## 3. Implementation Rules

### Scope

- Make targeted changes.
- Preserve existing behavior unless explicitly requested otherwise.
- Prefer modifying existing code over introducing new frameworks or dependencies.
- Avoid unrelated refactoring.
- Avoid unnecessary abstractions or additional configuration.
- Preserve existing public interfaces and configuration compatibility.

### JavaScript and CSS

- Prefer small, maintainable helpers.
- Scope CSS selectors narrowly.
- Avoid fragile generated class names where practical.
- Account for ChatGPT's dynamic DOM and React re-rendering.
- Use idempotent DOM modifications where needed.
- Fail gracefully when expected elements are unavailable.

Do not introduce broad fallback selectors without evidence they are needed.

### Git

- Inspect the active branch and working-tree status before making changes.
- Preserve unrelated changes.
- Do not reset, discard, or overwrite existing work.
- Do not force-push.
- Follow the user's requested branch and delivery workflow.
- Keep commits focused on the requested task.

Do not create branches, pull requests, or releases unless requested or required by the assigned workflow.

---

## 4. Security and Privacy

Preserve the application's existing security boundaries.

### Electron

Do not weaken:

- Renderer sandboxing.
- Context isolation.
- Node integration restrictions.
- Navigation and origin validation.
- Permission handling.
- Window ownership checks.
- Trusted control-surface isolation.

Changes involving privileged IPC, browser permissions, or native window ownership require focused security verification.

Do not expose privileged Electron APIs to remote ChatGPT content.

### User data

Never commit:

- `config.json`
- Browser profiles or session data.
- Credentials, cookies, or access tokens.
- Private conversation content or titles.
- Session URLs.
- Runtime logs.
- Generated installers or ZIP files.
- Runtime executables.
- Private screenshots or test recordings.

Use sanitized fixtures and `config.example.json` when examples are necessary.

Do not run profile-reset or deletion commands during normal development.

Do not use the production browser profile for automated tests.

### Local control server

When modifying the control server, preserve:

- Exact origin validation.
- Loopback-only access.
- Request size and timeout limits.
- Window ownership validation.
- Existing private-network permission safeguards.

Unrelated tasks do not require re-auditing these protections.

---

## 5. Risk-Based Verification

Choose the lowest verification level appropriate for the actual change.

Do not run every test suite automatically.

### Level 1 — Low Risk

Examples:

- Documentation.
- Comments.
- Minor CSS adjustments.
- Small formatting changes.
- Changes without behavioral impact.

Verification:

- Inspect the relevant diff.
- Run syntax or formatting checks when applicable.
- Perform a focused visual check only if the change affects rendering.

Full test suites are not required.

### Level 2 — Moderate Risk

Examples:

- JavaScript UI behavior.
- DOM selectors.
- Header controls.
- Responsive layout.
- Nonprivileged application logic.

Verification:

- Run relevant focused tests.
- Verify the changed behavior.
- Check related functionality likely to be affected.
- Review screenshots when visual output changes.

For DOM-dependent features, prefer realistic fixtures and actual UI evidence when available.

A passing synthetic fixture does not establish authenticated ChatGPT compatibility.

Do not repeat passing tests unless the relevant implementation changes.

### Level 3 — High Risk

Examples:

- Electron security.
- IPC authorization.
- Native window ownership.
- Profile management.
- File deletion.
- Installer or launch behavior.
- Control-server permissions.

Verification:

- Run focused security and regression tests.
- Verify relevant failure and rejection paths.
- Check for unintended changes to protected behavior.
- Run broader regression suites when the change has cross-component impact.

Run the aggregate suite once when warranted.

Do not repeatedly execute the same full suite without a specific reason.

### Available test commands

```powershell
npm test
npm run test:runtime
npm run test:host
npm run test:all
```

Choose the relevant command based on the affected component.

Use `npm run test:all` for broad or cross-component verification, not as a mandatory step for every task.

---

## 6. Visual Testing

Use existing Playwright fixtures for deterministic visual checks.

Update screenshot baselines only when an intentional visual change requires it.

Review relevant differences before accepting updated snapshots.

Do not repeatedly generate screenshots of unchanged components.

### Live UI verification

Live verification is appropriate when:

- A feature depends on ChatGPT's actual DOM.
- Offline fixtures cannot reproduce the reported problem.
- Authentication-dependent behavior is involved.
- The user specifically requests live verification.

Use the existing isolated live-audit or development-profile workflow when available and authorized.

Never expose private conversations, tokens, cookies, or session information in test output.

If live testing is unavailable, report the limitation and provide targeted manual verification steps.

**Do not block completion indefinitely because optional live verification is unavailable.**

Clearly distinguish verified behavior from unverified behavior.

### Test files and cleanup

Disposable test output belongs under:

`test-results/runs/`

Do not delete persistent data under:

- `test-results/live-review-profile/`
- `test-results/live-audits/`

Only clean task-owned disposable artifacts.

---

## 7. Agent Efficiency and Credit Usage

Optimize for useful progress rather than maximum tool usage.

### Investigation

- Inspect only files relevant to the task.
- Reuse existing findings and previous test results when still applicable.
- Avoid repeated whole-repository searches.
- Avoid repeatedly reading unchanged files.
- Do not conduct extensive research for straightforward implementation tasks.

### Planning

For simple tasks, proceed directly.

For moderately complex tasks, use a brief implementation plan.

For high-risk architectural tasks, perform enough planning to identify dependencies and security implications.

Do not generate lengthy planning documents unless requested.

### Delegation

Use the least expensive capable agent or reasoning level for each task.

Reserve advanced reasoning for genuinely complex architectural, security, or debugging work.

Avoid multiple agents independently investigating the same issue.

Parallelize only when tasks are independent and coordination overhead is justified.

Do not delegate trivial work unnecessarily.

### Tool usage

- Prefer targeted searches over broad searches.
- Batch related inspections when practical.
- Avoid redundant tool calls.
- Do not repeatedly regenerate unchanged outputs.
- Avoid installing or upgrading dependencies unless necessary.

### Debugging

When a test fails:

1. Identify the specific failure.
2. Determine whether it relates to the current change.
3. Apply a targeted correction.
4. Rerun the affected test.

Do not restart the entire verification process after every small correction.

If an external dependency, unavailable environment, or missing authorization blocks progress, complete independent work and report the remaining limitation.

Avoid speculative changes intended merely to make a test pass.

---

## 8. Execution and Safety

Routine development actions may proceed without repeated approval.

Examples:

- Reading source files.
- Editing task-related code.
- Running appropriate isolated tests.
- Reviewing diffs.
- Updating relevant documentation.

Do not automatically perform:

- Production profile resets.
- Destructive cleanup.
- Production configuration changes.
- Release publishing.
- Deployment.
- Force-pushes.
- Changes outside the requested project.

Obtain authorization for destructive or production-affecting operations when it has not already been provided.

Do not bypass security restrictions or modify external tool policies to complete a task.

---

## 9. Documentation

Update documentation when a change introduces or materially changes:

- Architecture.
- User-facing behavior.
- Configuration.
- Security boundaries.
- Installation requirements.
- Known limitations.

Do not update multiple documentation files for trivial changes.

Prefer concise, accurate updates to existing documentation.

Avoid duplicating information already maintained elsewhere.

---

## 10. Completion Criteria

Consider a task complete when:

1. The requested behavior is implemented.
2. Relevant verification has passed.
3. No known critical regression remains.
4. Security protections are preserved.
5. The resulting changes are appropriately scoped.
6. Remaining limitations are documented or reported.

Do not continue refining an already acceptable implementation without a concrete requirement.

### Final response

Provide a concise summary containing:

- What changed.
- Which files were modified.
- Tests performed and results.
- Known limitations or unverified behavior.
- Commit or pull-request information, when applicable.

Do not include lengthy development logs or repeated explanations unless requested.

**Primary rule: Complete the requested work efficiently, preserve safety, and stop once the acceptance criteria are satisfied.**