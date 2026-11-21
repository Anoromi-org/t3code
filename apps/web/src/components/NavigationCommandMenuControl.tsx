import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { isAnyCommandSurfaceOpen } from "../commandSurface";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useClientSettings } from "../hooks/useSettings";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { registerCommands } from "../shortcuts/dispatcher";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { NavigationCommandMenu } from "./NavigationCommandMenu";
import { resolveDraftProjectKeys, resolveProjectDraftId } from "./NavigationCommandMenu.logic";

/** Mounts the Mod+E thread/project navigation menu and owns its shortcut. */
export function NavigationCommandMenuControl() {
  const [open, setOpen] = useState(false);
  const projects = useProjects();
  const threads = useThreadShells();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const routeThreadRef = useThreadRouteRef();
  const logicalProjectDraftThreadKeyByLogicalProjectKey = useComposerDraftStore(
    (state) => state.logicalProjectDraftThreadKeyByLogicalProjectKey,
  );
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (state) => state.getDraftSessionByLogicalProjectKey,
  );
  const draftProjectKeys = resolveDraftProjectKeys({
    projects,
    draftLogicalProjectKeys: new Set(
      Object.keys(logicalProjectDraftThreadKeyByLogicalProjectKey).filter(
        (logicalProjectKey) => getDraftSessionByLogicalProjectKey(logicalProjectKey) !== null,
      ),
    ),
    projectGroupingSettings,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the Mod+E entry in the shortcut registry while mounted
  useEffect(
    () =>
      registerCommands(
        {
          "navigation.commandMenu": (event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          },
        },
        {
          // Capture so the shortcut still closes the menu while its input, which
          // stops keydown propagation, has focus.
          capture: true,
          when: () => !isAnyCommandSurfaceOpen("navigation"),
          context: () => ({
            terminalOpen: routeThreadRef
              ? selectThreadTerminalUiState(
                  useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                  routeThreadRef,
                ).terminalOpen
              : false,
            previewOpen: routeThreadRef
              ? selectActiveRightPanel(
                  useRightPanelStore.getState().byThreadKey,
                  routeThreadRef,
                ) === "preview"
              : false,
          }),
        },
      ),
    [routeThreadRef],
  );

  const selectThread = async (ref: ScopedThreadRef) => {
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  const selectProject = async (ref: ScopedProjectRef) => {
    const draftId = resolveProjectDraftId({
      projectRef: ref,
      projects,
      projectGroupingSettings,
      getDraftIdByLogicalProjectKey: (logicalProjectKey) =>
        getDraftSessionByLogicalProjectKey(logicalProjectKey)?.draftId ?? null,
    });
    if (draftId) {
      await navigate({ to: "/draft/$draftId", params: { draftId: DraftId.make(draftId) } });
      return;
    }
    await handleNewThread(ref);
  };

  return (
    <NavigationCommandMenu
      open={open}
      onOpenChange={setOpen}
      projects={projects}
      threads={threads}
      draftProjectKeys={draftProjectKeys}
      onSelectThread={selectThread}
      onSelectProject={selectProject}
    />
  );
}
