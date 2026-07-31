import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import type {
  GitManagerServiceError,
  VcsStatusInput,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "@t3tools/contracts";
import { mergeGitStatusParts } from "@t3tools/shared/git";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const DEFAULT_VCS_STATUS_REFRESH_INTERVAL = Duration.seconds(30);
// Fetch shared refs on the configured cadence, but avoid recomputing branch and
// PR status for every sidebar worktree more often than the PR cache can change.
const DEFAULT_WORKTREE_STATUS_REFRESH_INTERVAL = Duration.minutes(2);
const VCS_STATUS_REFRESH_FAILURE_BASE_DELAY = Duration.seconds(30);
const VCS_STATUS_REFRESH_FAILURE_MAX_DELAY = Duration.minutes(15);
const MAX_FAILURE_DIAGNOSTIC_VALUES = 8;
const MAX_FAILURE_DIAGNOSTIC_VALUE_LENGTH = 128;
const MAX_CONCURRENT_REMOTE_REFRESHES = 4;

function boundedDiagnosticValue(value: string): string {
  return value.slice(0, MAX_FAILURE_DIAGNOSTIC_VALUE_LENGTH);
}

function diagnosticValueTag(value: unknown): string {
  try {
    if (
      typeof value === "object" &&
      value !== null &&
      "_tag" in value &&
      typeof value._tag === "string"
    ) {
      return boundedDiagnosticValue(value._tag);
    }
    if (value instanceof Error) {
      return boundedDiagnosticValue(value.name);
    }
    return typeof value;
  } catch {
    return "Uninspectable";
  }
}

function diagnosticFailureOperation(value: unknown): string | undefined {
  try {
    if (
      typeof value === "object" &&
      value !== null &&
      "operation" in value &&
      typeof value.operation === "string"
    ) {
      return boundedDiagnosticValue(value.operation);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function addUniqueDiagnosticValue(values: Array<string>, value: string | undefined): void {
  if (
    value !== undefined &&
    values.length < MAX_FAILURE_DIAGNOSTIC_VALUES &&
    !values.includes(value)
  ) {
    values.push(value);
  }
}

export function remoteRefreshFailureDiagnostics(cause: Cause.Cause<unknown>) {
  const failureTags: Array<string> = [];
  const failureOperations: Array<string> = [];
  const defectTags: Array<string> = [];
  let failureCount = 0;
  let defectCount = 0;
  let interruptionCount = 0;

  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      failureCount += 1;
      addUniqueDiagnosticValue(failureTags, diagnosticValueTag(reason.error));
      addUniqueDiagnosticValue(failureOperations, diagnosticFailureOperation(reason.error));
      continue;
    }
    if (Cause.isDieReason(reason)) {
      defectCount += 1;
      addUniqueDiagnosticValue(defectTags, diagnosticValueTag(reason.defect));
      continue;
    }
    interruptionCount += 1;
  }

  return {
    reasonCount: cause.reasons.length,
    failureCount,
    failureTags,
    failureOperations,
    defectCount,
    defectTags,
    interruptionCount,
  };
}

interface VcsStatusChange {
  readonly cwd: string;
  readonly event: VcsStatusStreamEvent;
}

interface CachedValue<T> {
  readonly fingerprint: string;
  readonly value: T;
}

interface CachedVcsStatus {
  readonly local: CachedValue<VcsStatusLocalResult> | null;
  readonly remote: CachedValue<VcsStatusRemoteResult | null> | null;
}

interface ActiveRemotePoller {
  readonly fiber: Fiber.Fiber<void, never>;
  readonly subscriberCount: number;
  readonly demand: Ref.Ref<RepositoryDemand>;
  readonly wakeQueue: Queue.Queue<void>;
  readonly worktreeFailures: Ref.Ref<ReadonlyMap<string, WorktreeRefreshFailure>>;
  readonly nextCwdGeneration: Ref.Ref<number>;
}

interface CwdDemand {
  readonly subscriberCount: number;
  readonly demandCwds: ReadonlyMap<string, number>;
  readonly generation: number;
}

interface WorktreeRefreshFailure {
  readonly consecutiveFailures: number;
  readonly retryAt: number;
  readonly generation: number;
}

interface RepositoryDemand {
  readonly byCwd: ReadonlyMap<string, CwdDemand>;
  readonly pendingInitialCwds: ReadonlySet<string>;
}

interface StreamStatusOptions {
  readonly automaticRemoteRefreshInterval?: Effect.Effect<Duration.Duration, never>;
  readonly automaticWorktreeStatusRefreshInterval?: Effect.Effect<Duration.Duration, never>;
}

export class VcsAutoPullPolicy extends Context.Reference<{
  readonly isEnabled: (cwd: string) => Effect.Effect<boolean, never>;
}>("t3/vcs/VcsAutoPullPolicy", {
  defaultValue: () => ({ isEnabled: () => Effect.succeed(false) }),
}) {}

export const autoPullPolicyLayer = Layer.effect(
  VcsAutoPullPolicy,
  Effect.gen(function* () {
    const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    return {
      isEnabled: (cwd: string) =>
        snapshots.getActiveProjectByWorkspaceRoot(cwd).pipe(
          Effect.map((project) => project._tag === "Some" && project.value.autoPull === true),
          Effect.orElseSucceed(() => false),
        ),
    };
  }),
);

export function remoteRefreshFailureDelay(
  consecutiveFailures: number,
  configuredInterval: Duration.Duration,
) {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const backoffMs =
    Duration.toMillis(VCS_STATUS_REFRESH_FAILURE_BASE_DELAY) * Math.pow(2, exponent);
  const cappedBackoff = Duration.min(
    Duration.millis(backoffMs),
    VCS_STATUS_REFRESH_FAILURE_MAX_DELAY,
  );
  return Duration.max(configuredInterval, cappedBackoff);
}

export class VcsStatusBroadcaster extends Context.Service<
  VcsStatusBroadcaster,
  {
    readonly getStatus: (
      input: VcsStatusInput,
    ) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
    readonly refreshLocalStatus: (
      cwd: string,
    ) => Effect.Effect<VcsStatusLocalResult, GitManagerServiceError>;
    readonly refreshStatus: (cwd: string) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
    /**
     * Refresh a loaded cwd after a turn if background policy allows it.
     * GitManager retries missing PRs for the current branch and keeps known
     * PRs and failed lookup backoff cached. This does not fetch Git remotes.
     */
    readonly refreshPullRequestStatus: (
      cwd: string,
    ) => Effect.Effect<VcsStatusRemoteResult | null, GitManagerServiceError>;
    readonly streamStatus: (
      input: VcsStatusInput,
      options?: StreamStatusOptions,
    ) => Stream.Stream<VcsStatusStreamEvent, GitManagerServiceError>;
  }
>()("t3/vcs/VcsStatusBroadcaster") {}

function fingerprintStatusPart(status: unknown): string {
  return JSON.stringify(status);
}

const normalizeCwd = (cwd: string) =>
  Effect.service(FileSystem.FileSystem).pipe(
    Effect.flatMap((fs) => fs.realPath(cwd)),
    Effect.orElseSucceed(() => cwd),
  );

export const make = Effect.gen(function* () {
  const autoPullPolicy = yield* VcsAutoPullPolicy;
  const workflow = yield* GitWorkflowService.GitWorkflowService;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const fs = yield* FileSystem.FileSystem;
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<VcsStatusChange>(),
    (pubsub) => PubSub.shutdown(pubsub),
  );
  const broadcasterScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const cacheRef = yield* Ref.make(new Map<string, CachedVcsStatus>());
  // One permit per cwd for remote reads that write the cache. Without it a
  // periodic poll that started before `gh pr create` can finish after the
  // turn-end refresh and overwrite the fresh PR with its stale `pr: null`.
  const remoteWriteLocks = new Map<string, Semaphore.Semaphore>();
  const withRemoteWriteLock = <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>) => {
    let lock = remoteWriteLocks.get(cwd);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      remoteWriteLocks.set(cwd, lock);
    }
    return lock.withPermits(1)(effect);
  };
  const pollersRef = yield* SynchronizedRef.make(new Map<string, ActiveRemotePoller>());
  const globalRemoteRefreshSemaphore = yield* Semaphore.make(MAX_CONCURRENT_REMOTE_REFRESHES);

  const getCachedStatus = Effect.fn("VcsStatusBroadcaster.getCachedStatus")(function* (
    cwd: string,
  ) {
    return yield* Ref.get(cacheRef).pipe(Effect.map((cache) => cache.get(cwd) ?? null));
  });

  const updateCachedLocalStatus = Effect.fn("VcsStatusBroadcaster.updateCachedLocalStatus")(
    function* (cwd: string, local: VcsStatusLocalResult, options?: { publish?: boolean }) {
      const nextLocal = {
        fingerprint: fingerprintStatusPart(local),
        value: local,
      } satisfies CachedValue<VcsStatusLocalResult>;
      const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
        const previous = cache.get(cwd) ?? { local: null, remote: null };
        const nextCache = new Map(cache);
        nextCache.set(cwd, {
          ...previous,
          local: nextLocal,
        });
        return [previous.local?.fingerprint !== nextLocal.fingerprint, nextCache] as const;
      });

      if (options?.publish && shouldPublish) {
        yield* PubSub.publish(changesPubSub, {
          cwd,
          event: {
            _tag: "localUpdated",
            local,
          },
        });
      }

      return local;
    },
  );

  const updateCachedRemoteStatus = Effect.fn("VcsStatusBroadcaster.updateCachedRemoteStatus")(
    function* (cwd: string, remote: VcsStatusRemoteResult | null, options?: { publish?: boolean }) {
      const nextRemote = {
        fingerprint: fingerprintStatusPart(remote),
        value: remote,
      } satisfies CachedValue<VcsStatusRemoteResult | null>;
      const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
        const previous = cache.get(cwd) ?? { local: null, remote: null };
        const nextCache = new Map(cache);
        nextCache.set(cwd, {
          ...previous,
          remote: nextRemote,
        });
        return [previous.remote?.fingerprint !== nextRemote.fingerprint, nextCache] as const;
      });

      if (options?.publish && shouldPublish) {
        yield* PubSub.publish(changesPubSub, {
          cwd,
          event: {
            _tag: "remoteUpdated",
            remote,
          },
        });
      }

      return remote;
    },
  );

  const updateCachedStatus = Effect.fn("VcsStatusBroadcaster.updateCachedStatus")(function* (
    cwd: string,
    local: VcsStatusLocalResult,
    remote: VcsStatusRemoteResult | null,
    options?: { publish?: boolean },
  ) {
    const nextLocal = {
      fingerprint: fingerprintStatusPart(local),
      value: local,
    } satisfies CachedValue<VcsStatusLocalResult>;
    const nextRemote = {
      fingerprint: fingerprintStatusPart(remote),
      value: remote,
    } satisfies CachedValue<VcsStatusRemoteResult | null>;
    const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
      const previous = cache.get(cwd) ?? { local: null, remote: null };
      const nextCache = new Map(cache);
      nextCache.set(cwd, {
        local: nextLocal,
        remote: nextRemote,
      });
      return [
        previous.local?.fingerprint !== nextLocal.fingerprint ||
          previous.remote?.fingerprint !== nextRemote.fingerprint,
        nextCache,
      ] as const;
    });

    if (options?.publish && shouldPublish) {
      yield* PubSub.publish(changesPubSub, {
        cwd,
        event: {
          _tag: "snapshot",
          local,
          remote,
        },
      });
    }

    return mergeGitStatusParts(local, remote);
  });

  const loadLocalStatus = Effect.fn("VcsStatusBroadcaster.loadLocalStatus")(function* (
    cwd: string,
  ) {
    const local = yield* workflow.localStatus({ cwd });
    return yield* updateCachedLocalStatus(cwd, local);
  });

  const getOrLoadLocalStatus = Effect.fn("VcsStatusBroadcaster.getOrLoadLocalStatus")(function* (
    cwd: string,
  ) {
    const cached = yield* getCachedStatus(cwd);
    if (cached?.local) {
      return cached.local.value;
    }
    return yield* loadLocalStatus(cwd);
  });

  const withFileSystem = Effect.provideService(FileSystem.FileSystem, fs);

  const getStatus: VcsStatusBroadcaster["Service"]["getStatus"] = Effect.fn(
    "VcsStatusBroadcaster.getStatus",
  )(function* (input) {
    const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
    const cached = yield* getCachedStatus(cwd);
    if (cached?.local && cached.remote) {
      return mergeGitStatusParts(cached.local.value, cached.remote.value);
    }
    return yield* withRemoteWriteLock(
      cwd,
      Effect.gen(function* () {
        const latest = yield* getCachedStatus(cwd);
        const [local, remote] = yield* Effect.all(
          [
            latest?.local ? Effect.succeed(latest.local.value) : workflow.localStatus({ cwd }),
            latest?.remote ? Effect.succeed(latest.remote.value) : workflow.remoteStatus({ cwd }),
          ],
          { concurrency: "unbounded" },
        );
        return yield* updateCachedStatus(cwd, local, remote);
      }),
    );
  });

  const refreshLocalStatusCore = Effect.fn("VcsStatusBroadcaster.refreshLocalStatusCore")(
    function* (cwd: string) {
      yield* workflow.invalidateLocalStatus(cwd);
      const local = yield* workflow.localStatus({ cwd });
      return yield* updateCachedLocalStatus(cwd, local, { publish: true });
    },
  );

  const refreshLocalStatus: VcsStatusBroadcaster["Service"]["refreshLocalStatus"] = Effect.fn(
    "VcsStatusBroadcaster.refreshLocalStatus",
  )(function* (rawCwd) {
    const cwd = yield* withFileSystem(normalizeCwd(rawCwd));
    return yield* refreshLocalStatusCore(cwd);
  });

  const maybeAutoPull = Effect.fn("VcsStatusBroadcaster.maybeAutoPull")(function* (
    cwd: string,
    remote: VcsStatusRemoteResult | null,
    policyCwds: ReadonlyArray<string>,
  ) {
    return yield* Effect.gen(function* () {
      const autoPullEnabled = (yield* Effect.forEach(policyCwds, autoPullPolicy.isEnabled, {
        concurrency: "unbounded",
      })).some(Boolean);
      if (
        remote === null ||
        !remote.hasUpstream ||
        remote.aheadCount > 0 ||
        remote.behindCount <= 0 ||
        !autoPullEnabled
      ) {
        return null;
      }

      yield* workflow.invalidateLocalStatus(cwd);
      const local = yield* workflow.localStatus({ cwd });
      if (!local.isRepo || !local.isDefaultRef || local.hasWorkingTreeChanges) return null;

      yield* workflow.pullCurrentBranch(cwd);
      yield* workflow.invalidateStatus(cwd);
      const [refreshedLocal, refreshedRemote] = yield* Effect.all(
        [workflow.localStatus({ cwd }), workflow.remoteStatus({ cwd }, { refreshUpstream: false })],
        { concurrency: "unbounded" },
      );
      yield* updateCachedStatus(cwd, refreshedLocal, refreshedRemote, { publish: true });
      return { local: refreshedLocal, remote: refreshedRemote };
    }).pipe(
      Effect.catch(() =>
        Effect.logWarning("Automatic project pull failed", { cwd }).pipe(Effect.as(null)),
      ),
    );
  });

  const refreshRemoteStatus = Effect.fn("VcsStatusBroadcaster.refreshRemoteStatus")(function* (
    cwd: string,
    options?: {
      readonly refreshUpstream?: boolean;
      readonly policyCwds?: ReadonlyArray<string>;
    },
  ) {
    return yield* withRemoteWriteLock(
      cwd,
      Effect.gen(function* () {
        if (options?.refreshUpstream !== false) {
          yield* workflow.invalidateRemoteStatus(cwd);
        }
        const remote = yield* workflow.remoteStatus({ cwd }, options);
        const pulled = yield* maybeAutoPull(cwd, remote, options?.policyCwds ?? [cwd]);
        if (pulled !== null) return pulled.remote;
        return yield* updateCachedRemoteStatus(cwd, remote, { publish: true });
      }),
    );
  });

  const refreshStatus: VcsStatusBroadcaster["Service"]["refreshStatus"] = Effect.fn(
    "VcsStatusBroadcaster.refreshStatus",
  )(function* (rawCwd) {
    const cwd = yield* withFileSystem(normalizeCwd(rawCwd));
    // invalidateStatus (not the two partial invalidations) so an explicit
    // refresh also bypasses GitManager's slow PR-lookup cache.
    return yield* withRemoteWriteLock(
      cwd,
      Effect.gen(function* () {
        yield* workflow.invalidateStatus(cwd);
        const [local, remote] = yield* Effect.all(
          [workflow.localStatus({ cwd }), workflow.remoteStatus({ cwd })],
          { concurrency: "unbounded" },
        );
        const pulled = yield* maybeAutoPull(cwd, remote, [rawCwd]);
        if (pulled !== null) return mergeGitStatusParts(pulled.local, pulled.remote);
        return yield* updateCachedStatus(cwd, local, remote, { publish: true });
      }),
    );
  });

  const refreshPullRequestStatus: VcsStatusBroadcaster["Service"]["refreshPullRequestStatus"] =
    Effect.fn("VcsStatusBroadcaster.refreshPullRequestStatus")(function* (rawCwd) {
      const cwd = yield* withFileSystem(normalizeCwd(rawCwd));
      return yield* withRemoteWriteLock(
        cwd,
        Effect.gen(function* () {
          const cached = yield* getCachedStatus(cwd);
          if (cached?.remote?.value == null) return null;
          const repositoryKey =
            (yield* workflow.resolveRepositoryKey(cwd)) ?? `non-repository\0${cwd}`;
          const poller = (yield* SynchronizedRef.get(pollersRef)).get(repositoryKey);
          const demandCwds = poller
            ? [...((yield* Ref.get(poller.demand)).byCwd.get(cwd)?.demandCwds.keys() ?? [rawCwd])]
            : [rawCwd];
          const shouldRefresh = (yield* Effect.forEach(
            demandCwds,
            (demandCwd) =>
              backgroundPolicy.shouldRunScopeWork({ type: "vcs-status", cwd: demandCwd }),
            { concurrency: "unbounded" },
          )).some(Boolean);
          if (!shouldRefresh) return null;
          // Resolve the checked-out branch again. A cached PR can belong to
          // the previous branch after an agent checks out another branch.
          const remote = yield* workflow.remoteStatus(
            { cwd },
            { refreshUpstream: false, refreshMissingPullRequest: true },
          );
          return yield* updateCachedRemoteStatus(cwd, remote, { publish: true });
        }),
      );
    });

  const makeRemoteRefreshLoop = (
    demandRef: Ref.Ref<RepositoryDemand>,
    wakeQueue: Queue.Queue<void>,
    worktreeFailuresRef: Ref.Ref<ReadonlyMap<string, WorktreeRefreshFailure>>,
    automaticRemoteRefreshInterval: Effect.Effect<Duration.Duration, never>,
    automaticWorktreeStatusRefreshInterval: Effect.Effect<Duration.Duration, never>,
  ) => {
    return Effect.gen(function* () {
      const consecutiveFailuresRef = yield* Ref.make(0);
      const lastRepositoryRefreshAtRef = yield* Ref.make<number | null>(null);
      const lastWorktreeRefreshAtRef = yield* Ref.make<number | null>(null);
      const preferredCwdRef = yield* Ref.make<string | null>(null);
      const refreshRemoteStatusIfEnabled = Effect.gen(function* () {
        yield* Queue.clear(wakeQueue);
        const configuredInterval = yield* automaticRemoteRefreshInterval;
        const activeInterval = Duration.isZero(configuredInterval)
          ? DEFAULT_VCS_STATUS_REFRESH_INTERVAL
          : configuredInterval;
        const worktreeStatusInterval = yield* automaticWorktreeStatusRefreshInterval;
        const demand = yield* Ref.get(demandRef);
        const attemptedGenerations = new Map(
          [...demand.byCwd].map(([cwd, cwdDemand]) => [cwd, cwdDemand.generation] as const),
        );
        const activeCwds = (yield* Effect.all(
          [...demand.byCwd].map(([cwd, cwdDemand]) =>
            Effect.all(
              [...cwdDemand.demandCwds.keys()].map((demandCwd) =>
                backgroundPolicy.shouldRunScopeWork({
                  type: "vcs-status",
                  cwd: demandCwd,
                }),
              ),
              { concurrency: "unbounded" },
            ).pipe(Effect.map((results) => (results.some(Boolean) ? cwd : null))),
          ),
          { concurrency: "unbounded" },
        )).filter((cwd): cwd is string => cwd !== null);
        if (activeCwds.length === 0) {
          return activeInterval;
        }

        const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        const worktreeFailures = yield* Ref.updateAndGet(
          worktreeFailuresRef,
          (current) => new Map([...current].filter(([cwd]) => demand.byCwd.has(cwd))),
        );
        const eligibleCwds = activeCwds.filter((cwd) => {
          const failure = worktreeFailures.get(cwd);
          return (
            failure === undefined ||
            failure.generation !== demand.byCwd.get(cwd)?.generation ||
            failure.retryAt <= now
          );
        });
        const earliestWorktreeRetryAt = Math.min(
          ...activeCwds.map((cwd) => {
            const failure = worktreeFailures.get(cwd);
            return failure !== undefined && failure.generation === demand.byCwd.get(cwd)?.generation
              ? failure.retryAt
              : Number.POSITIVE_INFINITY;
          }),
        );
        const lastRepositoryRefreshAt = yield* Ref.get(lastRepositoryRefreshAtRef);
        const lastWorktreeRefreshAt = yield* Ref.get(lastWorktreeRefreshAtRef);
        const repositoryRefreshDue =
          !Duration.isZero(configuredInterval) &&
          (lastRepositoryRefreshAt === null ||
            now - lastRepositoryRefreshAt >= Duration.toMillis(activeInterval));
        const worktreeRefreshDue =
          lastWorktreeRefreshAt === null ||
          now - lastWorktreeRefreshAt >= Duration.toMillis(worktreeStatusInterval);
        const pendingCwds = eligibleCwds.filter((cwd) => demand.pendingInitialCwds.has(cwd));
        const targetCwds =
          !Duration.isZero(configuredInterval) && worktreeRefreshDue ? eligibleCwds : pendingCwds;
        if (Duration.isZero(configuredInterval) && targetCwds.length === 0) {
          return activeInterval;
        }
        const remainingRepositoryDelay = Duration.millis(
          Math.max(1, Duration.toMillis(activeInterval) - (now - (lastRepositoryRefreshAt ?? now))),
        );
        const remainingWorktreeDelay = Duration.millis(
          Math.max(
            1,
            Duration.toMillis(worktreeStatusInterval) - (now - (lastWorktreeRefreshAt ?? now)),
          ),
        );
        if (targetCwds.length === 0 && !repositoryRefreshDue) {
          return Duration.min(remainingRepositoryDelay, remainingWorktreeDelay);
        }
        const preferredCwd = yield* Ref.get(preferredCwdRef);
        const representativeCwd =
          (preferredCwd !== null && eligibleCwds.includes(preferredCwd) ? preferredCwd : null) ??
          targetCwds[0] ??
          eligibleCwds[0];
        if (!representativeCwd) {
          return Number.isFinite(earliestWorktreeRetryAt)
            ? Duration.millis(Math.max(1, earliestWorktreeRetryAt - now))
            : activeInterval;
        }

        const refreshOne = (cwd: string, refreshUpstream: boolean) =>
          globalRemoteRefreshSemaphore.withPermit(
            refreshRemoteStatus(cwd, {
              refreshUpstream,
              policyCwds: [...(demand.byCwd.get(cwd)?.demandCwds.keys() ?? [cwd])],
            }),
          );
        const attempts: Array<{
          readonly cwd: string;
          readonly exit: Exit.Exit<VcsStatusRemoteResult | null, GitManagerServiceError>;
        }> = [];
        const attemptRefresh = Effect.fn("VcsStatusBroadcaster.attemptRemoteRefresh")(function* (
          cwd: string,
          refreshUpstream: boolean,
        ) {
          const exit = yield* refreshOne(cwd, refreshUpstream).pipe(Effect.exit);
          attempts.push({ cwd, exit });
          return Exit.isSuccess(exit);
        });
        const attemptedCwds = new Set<string>();
        let repositoryRefreshSucceeded = !repositoryRefreshDue;

        if (repositoryRefreshDue) {
          const candidates = [
            representativeCwd,
            ...eligibleCwds.filter((cwd) => cwd !== representativeCwd),
          ];
          const distinctRemoteCandidates = new Map<string, string>();
          for (const cwd of candidates) {
            const remoteKey = yield* (
              workflow.resolveStatusRemoteKey?.(cwd) ?? Effect.succeed("default")
            ).pipe(Effect.orElseSucceed(() => `unresolved\0${cwd}`));
            if (remoteKey !== null && !distinctRemoteCandidates.has(remoteKey)) {
              distinctRemoteCandidates.set(remoteKey, cwd);
            }
          }
          repositoryRefreshSucceeded = true;
          for (const cwd of distinctRemoteCandidates.values()) {
            attemptedCwds.add(cwd);
            if (yield* attemptRefresh(cwd, true)) {
              yield* Ref.set(preferredCwdRef, cwd);
            } else {
              repositoryRefreshSucceeded = false;
            }
          }
        }

        const remainingTargetCwds = targetCwds.filter((cwd) => !attemptedCwds.has(cwd));
        yield* Effect.all(
          remainingTargetCwds.map((cwd) => attemptRefresh(cwd, false).pipe(Effect.asVoid)),
          { concurrency: MAX_CONCURRENT_REMOTE_REFRESHES },
        );

        if (attempts.length === 0 && repositoryRefreshDue) {
          yield* Ref.set(lastRepositoryRefreshAtRef, now);
          yield* Ref.set(consecutiveFailuresRef, 0);
          return Duration.min(activeInterval, remainingWorktreeDelay);
        }

        const interruptionReasons = attempts.flatMap(({ exit }) =>
          Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isInterruptReason) : [],
        );
        if (interruptionReasons.length > 0) {
          return yield* Effect.failCause(Cause.fromReasons<never>(interruptionReasons));
        }

        const successfulCwds = new Set(
          attempts.filter(({ exit }) => Exit.isSuccess(exit)).map(({ cwd }) => cwd),
        );
        yield* Ref.update(worktreeFailuresRef, (current) => {
          const next = new Map(current);
          for (const { cwd, exit } of attempts) {
            const generation = attemptedGenerations.get(cwd);
            if (generation === undefined) continue;
            if (Exit.isSuccess(exit)) {
              if (next.get(cwd)?.generation === generation) next.delete(cwd);
              continue;
            }
            const previous = next.get(cwd);
            if (previous && previous.generation > generation) continue;
            const consecutiveFailures =
              (previous?.generation === generation ? previous.consecutiveFailures : 0) + 1;
            next.set(cwd, {
              consecutiveFailures,
              retryAt:
                now +
                Duration.toMillis(remoteRefreshFailureDelay(consecutiveFailures, activeInterval)),
              generation,
            });
          }
          return next;
        });
        if (successfulCwds.size > 0) {
          if (repositoryRefreshDue && repositoryRefreshSucceeded) {
            yield* Ref.set(lastRepositoryRefreshAtRef, now);
          }
          if (targetCwds.length > 0) {
            yield* Ref.update(demandRef, (current) => ({
              ...current,
              pendingInitialCwds: new Set(
                [...current.pendingInitialCwds].filter((cwd) => !successfulCwds.has(cwd)),
              ),
            }));
          }
          if (worktreeRefreshDue) {
            yield* Ref.set(lastWorktreeRefreshAtRef, now);
          }
          yield* Ref.set(consecutiveFailuresRef, 0);
          const failedAttempts = attempts.filter(({ exit }) => Exit.isFailure(exit));
          for (const failed of failedAttempts) {
            if (Exit.isFailure(failed.exit)) {
              yield* Effect.logWarning("VCS worktree remote status refresh failed", {
                cwdLength: failed.cwd.length,
                ...remoteRefreshFailureDiagnostics(failed.exit.cause),
              });
            }
          }
          if (Duration.isZero(configuredInterval)) {
            return activeInterval;
          }
          const nextRepositoryDelay =
            repositoryRefreshDue && repositoryRefreshSucceeded
              ? activeInterval
              : remainingRepositoryDelay;
          const nextWorktreeDelay =
            worktreeRefreshDue && targetCwds.length > 0
              ? worktreeStatusInterval
              : remainingWorktreeDelay;
          return Duration.min(nextRepositoryDelay, nextWorktreeDelay);
        }

        const failureCauses = attempts.flatMap(({ exit }) =>
          Exit.isFailure(exit) ? [exit.cause] : [],
        );
        const cause = failureCauses.slice(1).reduce(Cause.combine, failureCauses[0] ?? Cause.empty);

        const consecutiveFailures = yield* Ref.updateAndGet(
          consecutiveFailuresRef,
          (count) => count + 1,
        );
        const nextDelay = remoteRefreshFailureDelay(consecutiveFailures, activeInterval);
        yield* Effect.logWarning("VCS remote status refresh failed", {
          cwdLength: representativeCwd.length,
          ...remoteRefreshFailureDiagnostics(cause),
          consecutiveFailures,
          nextDelayMs: Duration.toMillis(nextDelay),
        });
        return nextDelay;
      });
      const initialDemand = yield* Ref.get(demandRef);
      if (initialDemand.pendingInitialCwds.size === 0) {
        const configuredInterval = yield* automaticRemoteRefreshInterval;
        yield* Queue.take(wakeQueue).pipe(
          Effect.timeoutOption(
            Duration.isZero(configuredInterval)
              ? DEFAULT_VCS_STATUS_REFRESH_INTERVAL
              : configuredInterval,
          ),
        );
      }
      let nextDelay: Duration.Duration | null = null;
      while (true) {
        if (nextDelay !== null) {
          yield* Queue.take(wakeQueue).pipe(Effect.timeoutOption(nextDelay));
        }
        nextDelay = yield* refreshRemoteStatusIfEnabled;
      }
    });
  };

  const retainRemotePoller = Effect.fn("VcsStatusBroadcaster.retainRemotePoller")(function* (
    cwd: string,
    repositoryKey: string,
    demandCwd: string,
    automaticRemoteRefreshInterval: Effect.Effect<Duration.Duration, never>,
    automaticWorktreeStatusRefreshInterval: Effect.Effect<Duration.Duration, never>,
    needsInitialRefresh: boolean,
  ) {
    yield* SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
      const existing = activePollers.get(repositoryKey);
      if (existing) {
        return Ref.modify(existing.nextCwdGeneration, (nextGeneration) => [
          nextGeneration,
          nextGeneration + 1,
        ]).pipe(
          Effect.flatMap((newGeneration) =>
            Ref.update(existing.demand, (demand) => {
              const currentCwdDemand = demand.byCwd.get(cwd);
              const demandCwds = new Map(currentCwdDemand?.demandCwds ?? []);
              demandCwds.set(demandCwd, (demandCwds.get(demandCwd) ?? 0) + 1);
              const byCwd = new Map(demand.byCwd);
              byCwd.set(cwd, {
                subscriberCount: (currentCwdDemand?.subscriberCount ?? 0) + 1,
                demandCwds,
                generation: currentCwdDemand?.generation ?? newGeneration,
              });
              return {
                byCwd,
                pendingInitialCwds: needsInitialRefresh
                  ? new Set(demand.pendingInitialCwds).add(cwd)
                  : demand.pendingInitialCwds,
              };
            }),
          ),
          Effect.andThen(Queue.offer(existing.wakeQueue, undefined)),
          Effect.map(() => {
            const nextPollers = new Map(activePollers);
            nextPollers.set(repositoryKey, {
              ...existing,
              subscriberCount: existing.subscriberCount + 1,
            });
            return [undefined, nextPollers] as const;
          }),
        );
      }

      return Effect.all([
        Ref.make<RepositoryDemand>({
          byCwd: new Map([
            [cwd, { subscriberCount: 1, demandCwds: new Map([[demandCwd, 1]]), generation: 0 }],
          ]),
          pendingInitialCwds: needsInitialRefresh ? new Set([cwd]) : new Set(),
        }),
        Queue.sliding<void>(1),
        Ref.make<ReadonlyMap<string, WorktreeRefreshFailure>>(new Map()),
        Ref.make(1),
      ]).pipe(
        Effect.flatMap(([demand, wakeQueue, worktreeFailures, nextCwdGeneration]) =>
          makeRemoteRefreshLoop(
            demand,
            wakeQueue,
            worktreeFailures,
            automaticRemoteRefreshInterval,
            automaticWorktreeStatusRefreshInterval,
          ).pipe(
            Effect.forkIn(broadcasterScope),
            Effect.map((fiber) => {
              const nextPollers = new Map(activePollers);
              nextPollers.set(repositoryKey, {
                fiber,
                subscriberCount: 1,
                demand,
                wakeQueue,
                worktreeFailures,
                nextCwdGeneration,
              });
              return [undefined, nextPollers] as const;
            }),
          ),
        ),
      );
    });
  });

  const releaseRemotePoller = Effect.fn("VcsStatusBroadcaster.releaseRemotePoller")(function* (
    repositoryKey: string,
    cwd: string,
    demandCwd: string,
  ) {
    const pollerToRelease = yield* SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
      const existing = activePollers.get(repositoryKey);
      if (!existing) {
        return Effect.succeed([null, activePollers] as const);
      }

      if (existing.subscriberCount > 1) {
        return Ref.modify(existing.demand, (demand) => {
          const currentCwdDemand = demand.byCwd.get(cwd);
          if (!currentCwdDemand) return [false, demand] as const;
          const nextDemandCwds = new Map(currentCwdDemand.demandCwds);
          const count = nextDemandCwds.get(demandCwd) ?? 0;
          if (count <= 1) nextDemandCwds.delete(demandCwd);
          else nextDemandCwds.set(demandCwd, count - 1);
          const byCwd = new Map(demand.byCwd);
          const removedCwd = currentCwdDemand.subscriberCount <= 1;
          if (removedCwd) byCwd.delete(cwd);
          else {
            byCwd.set(cwd, {
              subscriberCount: currentCwdDemand.subscriberCount - 1,
              demandCwds: nextDemandCwds,
              generation: currentCwdDemand.generation,
            });
          }
          return [
            removedCwd,
            {
              byCwd,
              pendingInitialCwds: removedCwd
                ? new Set([...demand.pendingInitialCwds].filter((pending) => pending !== cwd))
                : demand.pendingInitialCwds,
            },
          ] as const;
        }).pipe(
          Effect.tap((removedCwd) =>
            removedCwd
              ? Ref.update(existing.worktreeFailures, (failures) => {
                  const next = new Map(failures);
                  next.delete(cwd);
                  return next;
                })
              : Effect.void,
          ),
          Effect.as([
            null,
            new Map(activePollers).set(repositoryKey, {
              ...existing,
              subscriberCount: existing.subscriberCount - 1,
            }),
          ] as const),
        );
      }

      return Effect.succeed([
        existing,
        new Map([...activePollers].filter(([key]) => key !== repositoryKey)),
      ] as const);
    });

    if (pollerToRelease) {
      yield* Fiber.interrupt(pollerToRelease.fiber).pipe(Effect.ignore);
      yield* Queue.shutdown(pollerToRelease.wakeQueue);
    }
  });

  const streamStatus: VcsStatusBroadcaster["Service"]["streamStatus"] = (input, options) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
        const repositoryKey =
          (yield* workflow.resolveRepositoryKey(cwd)) ?? `non-repository\0${cwd}`;
        const subscription = yield* PubSub.subscribe(changesPubSub);
        const initialLocal = yield* getOrLoadLocalStatus(cwd);
        const cachedStatus = yield* getCachedStatus(cwd);
        const initialRemote = cachedStatus?.remote?.value ?? null;
        yield* retainRemotePoller(
          cwd,
          repositoryKey,
          input.cwd,
          options?.automaticRemoteRefreshInterval ??
            Effect.succeed(DEFAULT_VCS_STATUS_REFRESH_INTERVAL),
          options?.automaticWorktreeStatusRefreshInterval ??
            Effect.succeed(DEFAULT_WORKTREE_STATUS_REFRESH_INTERVAL),
          cachedStatus?.remote === null || cachedStatus?.remote === undefined,
        );

        const release = releaseRemotePoller(repositoryKey, cwd, input.cwd).pipe(
          Effect.ignore,
          Effect.asVoid,
        );

        return Stream.concat(
          Stream.make({
            _tag: "snapshot" as const,
            local: initialLocal,
            remote: initialRemote,
          }),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => event.cwd === cwd),
            Stream.map((event) => event.event),
          ),
        ).pipe(Stream.ensuring(release));
      }),
    );

  return VcsStatusBroadcaster.of({
    getStatus,
    refreshLocalStatus,
    refreshStatus,
    refreshPullRequestStatus,
    streamStatus,
  });
});

export const layer = Layer.effect(VcsStatusBroadcaster, make);
