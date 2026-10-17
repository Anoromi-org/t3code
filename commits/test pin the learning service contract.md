# Test: pin the learning service contract

## Goal

The personal learning service (`~/code/experiments/learning-service`) drives T3 Code from outside: it mints its own bearer session, reads lesson threads, wakes them with a user message, and puts a "Lesson" button on hyprnav slot 3. None of that goes through the web client, so an upstream rebase can break it without any existing test noticing. Two suites now pin every behaviour it relies on; when one fails after a modernisation, fix T3 Code or change the learning service in the same step.

## Coverage

`apps/server/src/learningContract.test.ts` serves the production `auth` and `orchestration` HTTP groups (real `EnvironmentAuth`, real orchestration engine and projections, file-backed SQLite in a temp base dir) on a loopback port. It mints pairing tokens through the real `t3 auth pairing create --base-dir … --label learning-service --ttl 5m --json` command, as `src/t3/cli.ts mint` does, and sends requests copied from `src/t3/client.ts` and `src/t3/wake.ts`:

1. `POST /oauth/token` token exchange: the scope is narrowed to `orchestration:read orchestration:operate`, `token_type` is `Bearer`, `expires_in` is numeric, and the pairing token works only once (401 on reuse).
2. `GET /api/auth/session` returns `authenticated`, `sessionMethod: bearer-access-token`, `scopes` and `expiresAt`. A dead token also gets 200, with `authenticated: false`.
3. `GET /api/orchestration/threads/:id?turnLimit=1` returns `{ snapshotSequence, thread }` with every field `wake.ts` reads. An unknown thread returns 404 `{ code: "not_found" }`, which `wake.ts` maps to "thread missing".
4. `POST /api/orchestration/dispatch` with wake's exact `thread.turn.start` (echoing the snapshot's `modelSelection`, `runtimeMode` and `interactionMode`) returns `{ sequence }`, and the message appears in the thread. A running session shows up as `session.status`/`session.activeTurnId` (what `isBusy` reads) and clears again. The server itself does not reject a turn start on a busy thread, so the client-side busy check is the only guard.
5. A read-only token gets 403 `insufficient_scope` (`orchestration:operate`) on dispatch. An operate-only token gets 403 (`orchestration:read`) on read. No token gets 401.
6. Renewal: each re-mint issues a new token with a 30-day `expires_in`/`expiresAt`, and the earlier session stays valid.
7. `project.meta.update` accepts the `slot/slot3-binding.json` lesson binding and stores it unchanged. `codexThreadMcpArgs` forwards `T3CODE_THREAD_ID` and `T3CODE_ENVIRONMENT_ID` to the named MCP server.

`apps/desktop/src/hyprnav/learningContract.test.ts` decodes the verbatim `slot3-binding.json` bindings and checks that `{threadId}` is substituted shell-quoted: a hostile id reaches `sh` as a single argument. A manager sync then publishes slot 3 on the thread environment as `slot_command_set argv ["sh","-lc","…/open-lesson 'thread-lesson'"]` with display name `Lesson`.

## Notes

- `T3CODE_THREAD_ID`/`T3CODE_ENVIRONMENT_ID` go only to provider agent processes (the Codex app-server env, the Claude SDK env, and the Codex MCP `-c` overrides). The integrated terminal strips every `T3CODE_*` variable, and hyprnav slot commands run from the hyprnav daemon. In practice `open-lesson` gets the id from `$1`; its `$T3CODE_THREAD_ID` fallback only applies when an agent runs it.
- Run: `cd apps/server && vp test run src/learningContract.test.ts` and `cd apps/desktop && vp test run src/hyprnav/learningContract.test.ts`.
