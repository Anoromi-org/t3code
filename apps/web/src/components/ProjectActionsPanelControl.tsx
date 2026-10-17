import type {
  EditorId,
  EnvironmentId,
  ProjectScript,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { isAnyCommandSurfaceOpen, isCommandSurfaceOpen } from "../commandSurface";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { ProjectActionsPanel } from "./ProjectActionsPanel";
import {
  type GitActionRequestKind,
  resolveOpenProjectActionsShortcutDisposition,
} from "./ProjectActionsPanel.logic";

/**
 * Fork: owns the Mod+P project actions panel and its shortcut. The panel is
 * modal: its own toggle closes it and every other resolved shortcut is
 * swallowed so nothing acts behind it; unbound keys reach the panel.
 */
export function ProjectActionsPanelControl(props: {
  readonly environmentId: EnvironmentId;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly gitCwd: string | null;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onRunProjectScript: (script: ProjectScript) => void | Promise<void>;
  readonly onRequestGitAction: (action: GitActionRequestKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const { keybindings } = props;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: false, editableFocus: isEditableFocused(event.target) },
      });
      if (isCommandSurfaceOpen("project-actions")) {
        const disposition = resolveOpenProjectActionsShortcutDisposition(command);
        if (disposition === "ignore") return;
        event.preventDefault();
        event.stopPropagation();
        if (disposition === "close") setOpen(false);
        return;
      }
      if (command !== "projectActions.toggle" || event.defaultPrevented) return;
      if (isAnyCommandSurfaceOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  return (
    <ProjectActionsPanel
      availableEditors={props.availableEditors}
      environmentId={props.environmentId}
      gitCwd={props.gitCwd}
      keybindings={keybindings}
      onOpenChange={setOpen}
      onRequestGitAction={props.onRequestGitAction}
      onRunProjectScript={props.onRunProjectScript}
      open={open}
      scripts={props.scripts}
    />
  );
}
