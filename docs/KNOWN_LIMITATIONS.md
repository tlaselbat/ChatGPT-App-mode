# Known limitations and follow-up work

- ChatGPT is a frequently changing website, and its DOM selectors are not a supported extension API. Overrides may stop matching after frontend changes.
- The current fixed-position pin control overlaps fixture content slightly at a 390px viewport. The narrow screenshot records the current behavior; adjust its placement in a later UI task.
- Offline Playwright fixtures validate the local extension source and synthetic layouts only. They do not prove behavior on authenticated ChatGPT pages.
- The topmost server binds to loopback but currently sends wildcard CORS and private-network permission headers. Restrict request origins in a separate security patch, and test browser preflight and disallowed origins. Keep or remove the private-network grant based on verified Chromium behavior for the supported ChatGPT origins.
- Last-session and recent-chat metadata, server logs, and recent-chat shortcut names can expose chat URLs/titles in local plaintext. Git excludes these files; local storage retention remains a follow-up privacy decision.
- The runtime binary, portable browser data, logs, config, and shortcuts still live alongside source for compatibility. `.gitignore` creates a source boundary for Git; physically separating runtime artifacts can be considered later without moving the current install.
- Actual site verification requires a separate user-visible run in the development profile and may require authentication. Never use the production browser profile for automated tests.
- Visual snapshots can differ across Windows builds, font rendering, GPU drivers, and browser versions. Use the pinned package lock and same Chromium runtime for repeatable comparisons.
