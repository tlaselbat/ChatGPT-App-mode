# Source release packaging

Run `npm run test:all` on Windows with the pinned Electron and Playwright runtimes installed. The fixture suite tests synthetic Chromium pages; runtime tests exercise disposable PowerShell/native configurations; host tests exercise Electron. Native input checks need an unobstructed desktop and retain their ownership/focus guards. Passing offline tests does not establish authenticated live ChatGPT or third-party sign-in behavior.

Commit reviewed changes before packaging. From the repository root:

```powershell
.\Build-Release.ps1 -Revision HEAD -OutputPath .\ChatGPT-AppMode-source.zip
```

The command archives only the selected committed tree, refuses known runtime/private-data paths, and refuses to overwrite an existing file. Uncommitted changes are excluded. ZIP files remain ignored. This creates a source distribution; it does not publish or deploy anything, bundle an existing profile, or ship a potentially stale taskbar executable.

Extract into a fresh directory, install Node.js and the .NET Framework 4.8 compiler/reference assemblies, then run `Install-ChatGPT-AppMode.ps1`. The installer installs the pinned Electron runtime and builds the taskbar executable locally. Check startup, taskbar/tray actions, and sign-in in that fresh installation before publishing. Never use or include an existing production profile when verifying the package. Publication and deployment require separate authorization.
