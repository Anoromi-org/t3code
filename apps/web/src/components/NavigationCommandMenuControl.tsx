import { useAtomValue } from "@effect/atom-react";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { isAnyCommandSurfaceOpen } from "../commandSurface";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useClientSettings } from "../hooks/useSettings";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { resolveShortcutCommand } from "../keybindings";
import { selectProjectGroupingSettings } from "../logicalProject";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { resolveLayoutShortcutContext } from "./layoutShortcutContext";
import { NavigationCommandMenu } from "./NavigationCommandMenu";
import { resolveDraftProjectKeys, resolveProjectDraftId } from "./NavigationCommandMenu.logic";

/** Mounts the Mod+E thread/project navigation menu and owns its shortcut. */
export function NavigationCommandMenuControl() {
  const [open, setOpen] = useState(false);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isAnyCommandSurfaceOpen("navigation")) return;
      if (
        resolveShortcutCommand(event, keybindings, {
          context: resolveLayoutShortcutContext(event, routeThreadRef),
        }) !== "navigation.commandMenu"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen((current) => !current);
    };
    // Capture so the shortcut still closes the menu while its input, which
    // stops keydown propagation, has focus.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, routeThreadRef]);

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
