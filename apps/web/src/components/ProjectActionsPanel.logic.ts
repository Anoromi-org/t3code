import type {
  EditorId,
  KeybindingCommand,
  ProjectScript,
  VcsStatusResult,
} from "@t3tools/contracts";
import { buildMenuItems, resolveQuickAction } from "./GitActionsControl.logic";

export type ProjectActionGroupId = "project-actions" | "source-control" | "open-in";
export type GitActionRequestKind =
  | "quick"
  | "init"
  | "commit"
  | "pull"
  | "push"
  | "create_pr"
  | "open_pr"
  | "publish";

export interface GitActionRequest {
  readonly requestId: string;
  readonly action: GitActionRequestKind;
}

export type ProjectActionIntent =
  | { readonly kind: "run-script"; readonly scriptId: string }
  | { readonly kind: "git"; readonly action: GitActionRequestKind }
  | { readonly kind: "open-in"; readonly editor: EditorId }
  | { readonly kind: "status" };

export type ProjectActionIcon =
  | "script"
  | "git"
  | "commit"
  | "push"
  | "pull-request"
  | "publish"
  | "info"
  | "open-in";

export interface ProjectActionDescriptor {
  readonly id: string;
  readonly group: ProjectActionGroupId;
  readonly title: string;
  readonly description?: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly icon: ProjectActionIcon;
  readonly shortcutCommand?: KeybindingCommand;
  readonly intent: ProjectActionIntent;
  readonly selectable: boolean;
}

export interface ProjectActionGroup {
  readonly id: ProjectActionGroupId;
  readonly label: string;
  readonly items: ReadonlyArray<ProjectActionDescriptor>;
}

export interface ProjectActionOpenInTarget {
  readonly label: string;
  readonly value: EditorId;
}

export type OpenProjectActionsShortcutDisposition = "close" | "block" | "ignore";

export function resolveOpenProjectActionsShortcutDisposition(
  command: KeybindingCommand | null,
): OpenProjectActionsShortcutDisposition {
  if (command === null) return "ignore";
  return command === "projectActions.toggle" ? "close" : "block";
}

const GROUP_LABELS: Record<ProjectActionGroupId, string> = {
  "project-actions": "Project Actions",
  "source-control": "Source Control",
  "open-in": "Open In",
};

function scriptCommand(scriptId: string): KeybindingCommand {
  return `script.${scriptId}.run` as KeybindingCommand;
}

function gitIcon(action: GitActionRequestKind): ProjectActionIcon {
  if (action === "commit") return "commit";
  if (action === "push") return "push";
  if (action === "create_pr" || action === "open_pr") return "pull-request";
  if (action === "publish") return "publish";
  return "git";
}

function menuAction(item: ReturnType<typeof buildMenuItems>[number]): GitActionRequestKind {
  if (item.kind === "open_pr") return "open_pr";
  if (item.dialogAction === "push") return "push";
  if (item.dialogAction === "create_pr") return "create_pr";
  return "commit";
}

function statusDescriptor(title: string, description?: string): ProjectActionDescriptor {
  return {
    id: "git:status",
    group: "source-control",
    title,
    ...(description ? { description } : {}),
    searchTerms: [title, description ?? "", "git source control"],
    icon: "info",
    intent: { kind: "status" },
    selectable: false,
  };
}

export function buildProjectActionDescriptors(input: {
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly gitCwd: string | null;
  readonly gitStatus: VcsStatusResult | null;
  readonly gitStatusPending: boolean;
  readonly gitStatusError: string | null;
  readonly gitActionRunning: boolean;
  readonly openInTargets: ReadonlyArray<ProjectActionOpenInTarget>;
}): ProjectActionDescriptor[] {
  const descriptors: ProjectActionDescriptor[] = input.scripts.map((script) => ({
    id: `script:${script.id}`,
    group: "project-actions",
    title: script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name,
    description: script.command,
    searchTerms: [script.name, script.command, script.runOnWorktreeCreate ? "setup" : ""],
    icon: "script",
    shortcutCommand: scriptCommand(script.id),
    intent: { kind: "run-script", scriptId: script.id },
    selectable: true,
  }));

  if (input.gitCwd !== null) {
    if (input.gitStatusError) {
      descriptors.push(statusDescriptor("Source control unavailable", input.gitStatusError));
    } else if (input.gitStatusPending && input.gitStatus === null) {
      descriptors.push(statusDescriptor("Checking source control status..."));
    } else if (input.gitStatus && !input.gitStatus.isRepo) {
      if (input.gitActionRunning) {
        descriptors.push(statusDescriptor("Initializing Git..."));
      } else {
        descriptors.push({
          id: "git:init",
          group: "source-control",
          title: "Initialize Git",
          description: input.gitCwd,
          searchTerms: ["initialize git repository source control", input.gitCwd],
          icon: "git",
          intent: { kind: "git", action: "init" },
          selectable: true,
        });
      }
    } else if (input.gitStatus) {
      const quickAction = resolveQuickAction(
        input.gitStatus,
        input.gitActionRunning,
        input.gitStatus.isDefaultRef,
        input.gitStatus.hasPrimaryRemote,
      );
      const quickLabel = quickAction.disabled ? null : quickAction.label;
      if (!quickAction.disabled) {
        const quickIntentAction: GitActionRequestKind =
          quickAction.kind === "open_pr"
            ? "open_pr"
            : quickAction.kind === "run_pull"
              ? "pull"
              : quickAction.kind === "open_publish"
                ? "publish"
                : quickAction.action === "commit"
                  ? "commit"
                  : "quick";
        descriptors.push({
          id: `git:quick:${quickAction.kind}:${quickAction.action ?? "default"}`,
          group: "source-control",
          title: quickAction.label,
          description: input.gitStatus.refName ?? input.gitCwd,
          searchTerms: [
            quickAction.label,
            "git source control sync commit push pull pr pull request change request",
          ],
          icon: gitIcon(quickAction.kind === "run_pull" ? "pull" : "quick"),
          intent: { kind: "git", action: quickIntentAction },
          selectable: true,
        });
      }

      for (const item of buildMenuItems(
        input.gitStatus,
        input.gitActionRunning,
        input.gitStatus.hasPrimaryRemote,
      )) {
        if (item.disabled || item.label === quickLabel) continue;
        const action = menuAction(item);
        descriptors.push({
          id: `git:${action}`,
          group: "source-control",
          title: item.label,
          description: input.gitStatus.refName ?? input.gitCwd,
          searchTerms: [item.label, "git source control pr pull request change request"],
          icon: gitIcon(action),
          intent: { kind: "git", action },
          selectable: true,
        });
      }

      if (
        !input.gitActionRunning &&
        !input.gitStatus.hasPrimaryRemote &&
        quickAction.kind !== "open_publish"
      ) {
        descriptors.push({
          id: "git:publish",
          group: "source-control",
          title: "Publish repository...",
          description: input.gitCwd,
          searchTerms: ["publish repository remote github gitlab bitbucket azure devops"],
          icon: "publish",
          intent: { kind: "git", action: "publish" },
          selectable: true,
        });
      }

      if (!descriptors.some((descriptor) => descriptor.group === "source-control")) {
        descriptors.push(
          statusDescriptor(
            quickAction.kind === "show_hint"
              ? (quickAction.hint ?? quickAction.label)
              : "Source control is up to date.",
          ),
        );
      }
    } else {
      descriptors.push(statusDescriptor("Source control status is unavailable."));
    }
  }

  for (const target of input.openInTargets) {
    descriptors.push({
      id: `open-in:${target.value}`,
      group: "open-in",
      title: `Open in ${target.label}`,
      ...(input.gitCwd ? { description: input.gitCwd } : {}),
      searchTerms: ["open editor file manager", target.label, target.value, input.gitCwd ?? ""],
      icon: "open-in",
      intent: { kind: "open-in", editor: target.value },
      selectable: true,
    });
  }

  return descriptors;
}

function matchRank(descriptor: ProjectActionDescriptor, query: string): number {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return 0;
  const title = descriptor.title.toLowerCase();
  if (title === normalized) return 3;
  if (title.startsWith(normalized)) return 2;
  return descriptor.searchTerms.join(" ").toLowerCase().includes(normalized) ? 1 : -1;
}

export function filterProjectActionGroups(
  descriptors: ReadonlyArray<ProjectActionDescriptor>,
  query: string,
): ProjectActionGroup[] {
  const groupOrder: ReadonlyArray<ProjectActionGroupId> = [
    "project-actions",
    "source-control",
    "open-in",
  ];
  return groupOrder.flatMap((groupId) => {
    const items = descriptors
      .map((descriptor, index) => ({ descriptor, index, rank: matchRank(descriptor, query) }))
      .filter((entry) => entry.descriptor.group === groupId && entry.rank >= 0)
      .toSorted((left, right) => right.rank - left.rank || left.index - right.index)
      .map((entry) => entry.descriptor);
    return items.length > 0 ? [{ id: groupId, label: GROUP_LABELS[groupId], items }] : [];
  });
}
