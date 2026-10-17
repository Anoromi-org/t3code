# Test: pin the learning service contract

## Goal

The personal learning service (`~/code/experiments/learning-service`) drives T3 Code from outside: it mints its own bearer session, reads lesson threads, wakes them with a user message, and puts a "Lesson" button on hyprnav slot 3. None of that goes through the web client, so an upstream rebase can break it without any existing test noticing. Two suites pin what it relies on; when one fails after a modernisation, fix T3 Code or change the learning service in the same step.

## Coverage

`apps/server/src/learningContract.test.ts` spawns the real server (`bin.ts --base-dir <tmp>`) on a loopback port, mints pairing tokens through `t3 auth pairing create --base-dir … --label learning-service --ttl 5m --json` as `src/t3/cli.ts mint` does, and sends requests copied from `src/t3/client.ts`:

1. `POST /oauth/token` token exchange narrows the scope to `orchestration:read orchestration:operate`, returns `Bearer` and a numeric `expires_in`, and accepts a pairing token once (401 on reuse).
2. `GET /api/auth/session` reports `authenticated`, `sessionMethod: bearer-access-token` and the scopes; a dead token gets 200 with `authenticated: false`.
3. `GET /api/orchestration/threads/:id/bounded` with `x-t3-orchestration-protocol: 2` returns the `projection.thread` fields `getThread` reads and the `runs` `isBusy` checks. An unknown thread is 404, which `wake.ts` maps to "thread missing".
4. `message.dispatch` (`dispatchMode: start_immediately`) over a `/ws` socket opened with a websocket ticket and `orchestrationProtocol=2` returns `{ sequence }`; the user message and a run appear on the thread.
5. A read-only token gets `EnvironmentAuthorizationError` (`orchestration:operate`) on dispatch, an operate-only token gets 403 on read, no token gets 401.
6. Re-minting issues a new 30-day token and the earlier session stays valid.
7. `POST /api/projects/mutate` `project.update` stores the slot-3 lesson binding unchanged.

`apps/desktop/src/hyprnav/learningContract.test.ts` decodes the verbatim `slot3-binding.json` bindings, checks that `{threadId}` is substituted shell-quoted (a hostile id reaches `sh` as one argument), and that a manager sync publishes slot 3 as `sh -lc "…/open-lesson 'thread-lesson'"` named `Lesson`.

## Notes

- Upstream orchestration v2 replaced the old thread snapshot (`?turnLimit`, `session.status`) and `POST /api/orchestration/dispatch` with `thread.turn.start`. The learning service now reads the bounded snapshot and dispatches `message.dispatch` over the RPC socket; this suite pins that new shape.
- `T3CODE_THREAD_ID` forwarding to agents and named Codex MCP servers is covered by `apps/server/src/provider/threadAttribution.test.ts`.
- Run: `cd apps/server && vp test run src/learningContract.test.ts` and `cd apps/desktop && vp test run src/hyprnav/learningContract.test.ts`.
