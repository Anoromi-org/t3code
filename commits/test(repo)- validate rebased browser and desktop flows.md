# Validate rebased browser and desktop flows

Run all eleven preserved browser suites and the isolated Linux desktop smoke test. Update browser fixtures for upstream exports, router location, environment capabilities, composer drawer placement, and branch descriptions. Keep every scenario and its behavioral assertions.

Read Electron's runtime environment through its local inspector because Chromium can clear the initial environment exposed by `/proc`. Bound the inspector request, retain backend and launcher assertions, and select an available shell on NixOS.

Validation: 60 browser tests pass; desktop smoke passes; integrated web pairing, project creation, slash commands, shortcuts, and Hyprnav persistence pass. Format, lint, and type checks pass. Update the modernization coverage record with the completed UI checks.
