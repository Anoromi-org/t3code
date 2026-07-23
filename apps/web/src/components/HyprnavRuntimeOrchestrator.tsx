import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
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
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const effectiveSettings = useMemo(
    () => resolveEffectiveHyprnavSettings(project?.hyprnav, defaults),
    [defaults, project?.hyprnav],
  );
  const target = useMemo(
    () => resolveActiveHyprnavSyncTarget({ primaryEnvironmentId, project, thread }),
    [primaryEnvironmentId, project, thread],
  );
  const requestKey = createActiveHyprnavRequestKey({
    target,
    settings: effectiveSettings,
    availableEditors,
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
    const request = {
      projectRoot: target.projectRoot,
      worktreePath: target.worktreePath,
      threadId: target.threadId,
      threadTitle: target.threadTitle,
      hyprnav: effectiveSettings,
      clearBindings: cleanup.clearBindings,
      clearNames: cleanup.clearNames,
      lock: true,
    } as const;
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
            if (hyprnavSyncNeedsScopeRetry(request, result)) {
              await delay.wait(HYPRNAV_BACKGROUND_RETRY_DELAY_MS);
              continue;
            }
            if (credentialRefreshDelay === null) return;
            await delay.wait(credentialRefreshDelay);
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
  }, [requestKey]);

  return null;
}
