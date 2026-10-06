import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { DesktopHyprnavSyncInput, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { isElectron } from "../env";
import { useClientSettings } from "../hooks/useSettings";
import {
  createCancelableHyprnavDelay,
  computeActiveHyprnavCleanup,
  createActiveHyprnavRequestKey,
  hyprnavCredentialRefreshDelay,
  hyprnavPublicationHistory,
  hyprnavSyncNeedsScopeRetry,
  isHyprnavDesktopRuntimeAvailable,
  markActiveHyprnavPublicationAttempt,
  persistHyprnavPublicationHistory,
  publishHyprnavRequests,
  recordActiveHyprnavPublication,
  resolveActiveHyprnavSyncTarget,
  resolveEffectiveHyprnavSettings,
} from "../hyprnavRuntime";
import {
  computeHyprnavBrowserTabClears,
  hyprnavBrowserTabHistory,
  hyprnavBrowserTabHistoryKey,
  hyprnavThreadBindingSlots,
  markHyprnavBrowserTabAttempt,
  persistHyprnavBrowserTabHistory,
  recordHyprnavBrowserTabs,
  resolveHyprnavBrowserTabs,
} from "../hyprnavBrowserSlots";
import { consumeFollowedThread } from "../hyprnavLockFollower";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useProject, useThreadShell } from "../state/entities";
import { primaryServerAvailableEditorsAtom } from "../state/server";
import { toastManager } from "./ui/toast";

const HYPRNAV_BACKGROUND_RETRY_DELAY_MS = 5_000;

export function HyprnavRuntimeOrchestrator({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const thread = useThreadShell(threadRef);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  const defaults = useClientSettings((settings) => settings.defaultProjectHyprnavSettings);
  const publishLock = useClientSettings((settings) => settings.hyprnavPublishLock);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const effectiveSettings = useMemo(
    () => resolveEffectiveHyprnavSettings(project?.hyprnav, defaults),
    [defaults, project?.hyprnav],
  );
  const target = useMemo(
    () => resolveActiveHyprnavSyncTarget({ primaryEnvironmentId, project, thread }),
    [primaryEnvironmentId, project, thread],
  );
  const browserSlots = useClientSettings((settings) => settings.hyprnavBrowserSlots);
  const branch = thread?.branch ?? null;
  const checkoutPath = target ? (target.worktreePath ?? target.projectRoot) : null;
  const browserTabs = useMemo(
    () =>
      resolveHyprnavBrowserTabs({
        slots: browserSlots,
        thread: { branch, checkoutPath },
        bindingSlots: hyprnavThreadBindingSlots(effectiveSettings),
      }),
    [browserSlots, branch, checkoutPath, effectiveSettings],
  );
  const requestKey = createActiveHyprnavRequestKey({
    target,
    settings: effectiveSettings,
    availableEditors,
    browserTabs,
  });

  // requestKey fingerprints every semantic input below. Projection upserts replace
  // thread/project objects during normal activity, but must not restart this loop.
  useEffect(() => {
    if (!isElectron || !target || !requestKey || !isHyprnavDesktopRuntimeAvailable()) return;

    let cancelled = false;
    let warned = false;
    const delay = createCancelableHyprnavDelay();
    const credentialRefreshDelay = hyprnavCredentialRefreshDelay(effectiveSettings);
    const cleanup = computeActiveHyprnavCleanup({
      history: hyprnavPublicationHistory,
      target,
      settings: effectiveSettings,
    });
    const browserTabKey = hyprnavBrowserTabHistoryKey(target);
    const clearBrowserTabs = computeHyprnavBrowserTabClears(
      hyprnavBrowserTabHistory.get(browserTabKey),
      browserTabs,
    );
    const firstRequest: DesktopHyprnavSyncInput = {
      projectRoot: target.projectRoot,
      worktreePath: target.worktreePath,
      threadId: target.threadId,
      threadTitle: target.threadTitle,
      projectTitle: target.projectTitle,
      worktreeTitle: target.worktreeTitle,
      hyprnav: effectiveSettings,
      clearBindings: cleanup.clearBindings,
      clearNames: cleanup.clearNames,
      browserTabs,
      clearBrowserTabs,
      // A thread the follower opened is already locked; locking it again could
      // undo a newer lock the user made in hyprnav meanwhile.
      lock: publishLock && !consumeFollowedThread(threadRef),
    };
    // Refreshes only renew credentials; the lock may have moved since.
    const refreshRequest = { ...firstRequest, clearBrowserTabs: [], lock: false };
    let request = firstRequest;
    let browserTabWarning: string | null = null;
    void (async () => {
      for (;;) {
        if (cancelled) return;
        try {
          const result = await publishHyprnavRequests({
            requests: [request],
            availableEditors,
            resolvePreferredEditor: resolveAndPersistPreferredEditor,
            isCurrent: () => !cancelled,
            onBeforeSync: () => {
              markActiveHyprnavPublicationAttempt({
                history: hyprnavPublicationHistory,
                target,
                settings: effectiveSettings,
              });
              persistHyprnavPublicationHistory(hyprnavPublicationHistory);
              markHyprnavBrowserTabAttempt(hyprnavBrowserTabHistory, browserTabKey, browserTabs);
              persistHyprnavBrowserTabHistory(hyprnavBrowserTabHistory);
            },
            onAfterSync: (_request, syncResult) => {
              // Browser tab failures ride on an ok result so the lock is not retried.
              if (syncResult.status === "ok" && syncResult.message) {
                browserTabWarning = syncResult.message;
              }
            },
          });
          if (cancelled) return;
          if (result.status === "ok") {
            recordActiveHyprnavPublication({
              history: hyprnavPublicationHistory,
              target,
              settings: effectiveSettings,
              ...(result.appliedScopes ? { appliedScopes: result.appliedScopes } : {}),
            });
            persistHyprnavPublicationHistory(hyprnavPublicationHistory);
            if (browserTabWarning === null && result.appliedScopes?.includes("thread") !== false) {
              recordHyprnavBrowserTabs(hyprnavBrowserTabHistory, browserTabKey, browserTabs);
              persistHyprnavBrowserTabHistory(hyprnavBrowserTabHistory);
            }
            if (browserTabWarning !== null && !warned) {
              warned = true;
              toastManager.add({
                type: "warning",
                title: "Hyprnav browser slot failed",
                description: browserTabWarning,
              });
            }
            browserTabWarning = null;
            if (hyprnavSyncNeedsScopeRetry(request, result)) {
              await delay.wait(HYPRNAV_BACKGROUND_RETRY_DELAY_MS);
              continue;
            }
            if (credentialRefreshDelay === null) return;
            await delay.wait(credentialRefreshDelay);
            request = refreshRequest;
            continue;
          }
          if (!warned) {
            warned = true;
            toastManager.add({
              type: "warning",
              title: "Hyprnav sync failed",
              description: result.message ?? "Hyprnav could not sync the active worktree.",
            });
          }
        } catch (error) {
          if (cancelled) return;
          if (!warned) {
            warned = true;
            toastManager.add({
              type: "warning",
              title: "Hyprnav sync failed",
              description:
                error instanceof Error
                  ? error.message
                  : "Hyprnav could not sync the active worktree.",
            });
          }
        }
        await delay.wait(HYPRNAV_BACKGROUND_RETRY_DELAY_MS);
      }
    })();

    return () => {
      cancelled = true;
      delay.cancel();
    };
  }, [requestKey, publishLock]);

  return null;
}
