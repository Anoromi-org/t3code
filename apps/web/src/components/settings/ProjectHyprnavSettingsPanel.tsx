import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_PROJECT_HYPRNAV_SETTINGS,
  type EnvironmentId,
  type DesktopHyprnavSyncInput,
  type GroupedProjectHyprnavState,
  type ProjectHyprnavAction,
  type ProjectHyprnavBinding,
  type ProjectHyprnavOverride,
  type ProjectHyprnavScope,
  type ProjectHyprnavSettings,
  type ProjectHyprnavWorkspaceTarget,
  type ProjectId,
} from "@t3tools/contracts";
import { AlertTriangleIcon, MinusIcon, PlusIcon, RouteIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  useClientSettings,
  useClientSettingsHydrated,
  usePersistClientSettings,
  usePrimarySettings,
} from "../../hooks/useSettings";
import { useProject } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  buildProjectHyprnavSyncJobs,
  computeClearedHyprnavBindingNames,
  computeRemovedHyprnavBindings,
  HYPRNAV_ACTION_ROWS,
  HYPRNAV_SCOPE_ROWS,
  HYPRNAV_WORKSPACE_ROWS,
  findHyprnavActionLabel,
  findHyprnavScopeLabel,
  findHyprnavWorkspaceLabel,
  resolveProjectHyprnavSettings,
  validateProjectHyprnavSettings,
} from "../../hyprnavSettings";
import {
  computeActiveHyprnavCleanup,
  type HyprnavPublicationScopeState,
  hyprnavPublicationHistory,
  hyprnavPublicationScopesForRequest,
  hyprnavPublicationTargetFromRequest,
  markActiveHyprnavPublicationAttempt,
  persistHyprnavPublicationHistory,
  publishHyprnavRequests,
  recordActiveHyprnavPublication,
} from "../../hyprnavRuntime";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
  type ProjectGroupingSettings,
} from "../../logicalProject";
import { useProjects, useThreadShells } from "../../state/entities";
import { primaryServerAvailableEditorsAtom } from "../../state/server";
import type { Project, ThreadShell } from "../../types";
import { deduplicateProjectsByPhysicalKey } from "../../sidebarProjectGrouping";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

export type HyprnavDraftBinding = {
  readonly id: string;
  readonly slot: string;
  readonly scope: ProjectHyprnavScope;
  readonly workspaceMode: ProjectHyprnavWorkspaceTarget["mode"];
  readonly workspaceId: string;
  readonly name: string;
  readonly action: ProjectHyprnavAction;
  readonly command: string;
};

export function createProjectHyprnavModeCoordinator() {
  let active: {
    readonly mode: GroupedProjectHyprnavState["mode"];
    readonly promise: Promise<void>;
  } | null = null;

  return {
    change(mode: GroupedProjectHyprnavState["mode"], persist: () => Promise<void>): Promise<void> {
      const promise = Promise.resolve().then(persist);
      const transition = { mode, promise };
      active = transition;
      void promise.catch(() => {
        if (active === transition) active = null;
      });
      return promise;
    },
    reconcile(mode: GroupedProjectHyprnavState["mode"]): void {
      if (active?.mode === mode) active = null;
    },
    async beforeSave(
      fallbackMode: GroupedProjectHyprnavState["mode"],
    ): Promise<GroupedProjectHyprnavState["mode"]> {
      const transition = active;
      if (!transition) return fallbackMode;
      await transition.promise;
      return transition.mode;
    },
  };
}

export async function transitionProjectHyprnavMode(input: {
  readonly mode: GroupedProjectHyprnavState["mode"];
  readonly synchronizeSameSettings: () => Promise<void>;
  readonly persistMode: () => Promise<void>;
  readonly rollbackSameSettings: () => Promise<void>;
}): Promise<void> {
  if (input.mode !== "same") {
    await input.persistMode();
    return;
  }

  await input.synchronizeSameSettings();
  try {
    await input.persistMode();
  } catch (error) {
    try {
      await input.rollbackSameSettings();
    } catch (rollbackError) {
      const persistenceMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(
        `${persistenceMessage} Could not restore the previous grouped project settings: ${rollbackMessage}`,
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

export function hyprnavDraftFromSettings(settings: ProjectHyprnavSettings): HyprnavDraftBinding[] {
  return settings.bindings.map((binding) => ({
    id: binding.id,
    slot: String(binding.slot),
    scope: binding.scope,
    workspaceMode: binding.workspace.mode,
    workspaceId: binding.workspace.mode === "absolute" ? String(binding.workspace.workspaceId) : "",
    name: binding.name ?? "",
    action: binding.action,
    command: binding.action === "shell-command" ? binding.command : "",
  }));
}

export function parseHyprnavDraft(draft: readonly HyprnavDraftBinding[]): {
  readonly settings: ProjectHyprnavSettings | null;
  readonly message: string | null;
} {
  const bindings: ProjectHyprnavBinding[] = [];
  for (const item of draft) {
    const slot = Number(item.slot);
    if (!Number.isSafeInteger(slot) || slot < 1) {
      return { settings: null, message: "Every slot must be a positive whole number." };
    }
    const workspace =
      item.workspaceMode === "managed"
        ? ({ mode: "managed" } as const)
        : Number.isSafeInteger(Number(item.workspaceId)) && Number(item.workspaceId) >= 1
          ? ({ mode: "absolute", workspaceId: Number(item.workspaceId) } as const)
          : null;
    if (!workspace) {
      return { settings: null, message: "Absolute workspaces need a positive workspace number." };
    }
    if (item.name.trim().length > 255) {
      return { settings: null, message: "Binding names must be 255 characters or fewer." };
    }
    const common = {
      id: item.id,
      slot,
      scope: item.scope,
      workspace,
      ...(item.name.trim() ? { name: item.name.trim() } : {}),
    };
    bindings.push(
      item.action === "shell-command"
        ? { ...common, action: "shell-command", command: item.command.trim() }
        : { ...common, action: item.action },
    );
  }

  const settings: ProjectHyprnavSettings = { bindings };
  const validation = validateProjectHyprnavSettings(settings);
  if (validation.duplicateScopedSlots.length > 0) {
    return { settings: null, message: "Each scope can use a slot only once." };
  }
  if (validation.emptyShellCommandBindingIds.length > 0) {
    return { settings: null, message: "Shell command bindings need a command." };
  }
  return { settings, message: null };
}

export function resolveProjectHyprnavNextOverride(input: {
  readonly parsedSettings: ProjectHyprnavSettings;
  readonly defaultProjectHyprnavSettings: ProjectHyprnavSettings;
  readonly forceInherited: boolean;
}): ProjectHyprnavOverride {
  if (
    input.forceInherited ||
    JSON.stringify(input.parsedSettings) === JSON.stringify(input.defaultProjectHyprnavSettings)
  ) {
    return null;
  }
  return input.parsedSettings;
}

export function resolveProjectHyprnavGroup(input: {
  readonly selectedProject: Project;
  readonly projects: readonly Project[];
  readonly groupingSettings: ProjectGroupingSettings;
  readonly stateByLogicalProjectKey: Readonly<Record<string, GroupedProjectHyprnavState>>;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): {
  readonly logicalProjectKey: string;
  readonly mode: GroupedProjectHyprnavState["mode"];
  readonly groupedMembers: readonly Project[];
  readonly members: readonly Project[];
  readonly sharedSettingsProject: Project;
  readonly settingsProject: Project;
} {
  const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
    input.selectedProject,
    input.groupingSettings,
  );
  const visibleProjects = deduplicateProjectsByPhysicalKey({
    projects: input.projects,
    settings: input.groupingSettings,
    primaryEnvironmentId: input.primaryEnvironmentId,
  });
  const groupedMembers = visibleProjects.filter(
    (candidate) =>
      deriveLogicalProjectKeyFromSettings(candidate, input.groupingSettings) === logicalProjectKey,
  );
  const sharedMembers = groupedMembers.length > 0 ? groupedMembers : [input.selectedProject];
  const state = input.stateByLogicalProjectKey[logicalProjectKey];
  const firstPersistedSettings = JSON.stringify(sharedMembers[0]?.hyprnav ?? null);
  const hasDivergentPersistedSettings = sharedMembers.some(
    (member) => JSON.stringify(member.hyprnav ?? null) !== firstPersistedSettings,
  );
  const mode = state?.mode ?? (hasDivergentPersistedSettings ? "separate" : "same");
  const members = mode === "same" ? sharedMembers : [input.selectedProject];
  const explicitDefault = state?.defaultProjectKey
    ? sharedMembers.find((candidate) => {
        const scopedKey = scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id));
        return (
          state.defaultProjectKey === scopedKey ||
          state.defaultProjectKey === derivePhysicalProjectKey(candidate)
        );
      })
    : undefined;
  const primaryLocalDefault =
    input.primaryEnvironmentId !== null
      ? sharedMembers.find((candidate) => candidate.environmentId === input.primaryEnvironmentId)
      : undefined;
  const stableDefault = [...sharedMembers].sort((left, right) =>
    derivePhysicalProjectKey(left).localeCompare(derivePhysicalProjectKey(right)),
  )[0];
  const sharedSettingsProject =
    explicitDefault ?? primaryLocalDefault ?? stableDefault ?? input.selectedProject;
  const settingsProject = mode === "same" ? sharedSettingsProject : input.selectedProject;

  return {
    logicalProjectKey,
    mode,
    groupedMembers,
    members,
    sharedSettingsProject,
    settingsProject,
  };
}

export function selectInheritedLocalHyprnavProjects(input: {
  readonly projects: readonly Project[];
  readonly groupingSettings: ProjectGroupingSettings;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): Project[] {
  return deduplicateProjectsByPhysicalKey({
    projects: input.projects,
    settings: input.groupingSettings,
    primaryEnvironmentId: input.primaryEnvironmentId,
  }).filter(
    (project) =>
      project.environmentId === input.primaryEnvironmentId &&
      (project.hyprnav === null || project.hyprnav === undefined),
  );
}

export function updateGroupedProjectHyprnavMode(input: {
  readonly stateByLogicalProjectKey: Readonly<Record<string, GroupedProjectHyprnavState>>;
  readonly logicalProjectKey: string;
  readonly mode: GroupedProjectHyprnavState["mode"];
  readonly sharedSettingsProject: Project;
}): Record<string, GroupedProjectHyprnavState> {
  return {
    ...input.stateByLogicalProjectKey,
    [input.logicalProjectKey]: {
      ...input.stateByLogicalProjectKey[input.logicalProjectKey],
      mode: input.mode,
      ...(input.mode === "same"
        ? { defaultProjectKey: derivePhysicalProjectKey(input.sharedSettingsProject) }
        : {}),
    },
  };
}

type ProjectHyprnavMemberUpdateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: Error };

export async function applyProjectHyprnavGroupChange(input: {
  readonly members: readonly Project[];
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly nextHyprnav: ProjectHyprnavOverride;
  readonly update: (
    member: Project,
    hyprnav: ProjectHyprnavOverride,
  ) => Promise<ProjectHyprnavMemberUpdateResult>;
}): Promise<ProjectHyprnavMemberUpdateResult> {
  const orderedMembers = [...input.members].sort((left, right) => {
    const leftIsPrimary = left.environmentId === input.primaryEnvironmentId;
    const rightIsPrimary = right.environmentId === input.primaryEnvironmentId;
    if (leftIsPrimary !== rightIsPrimary) return leftIsPrimary ? 1 : -1;
    return derivePhysicalProjectKey(left).localeCompare(derivePhysicalProjectKey(right));
  });
  const completed: Project[] = [];

  for (const member of orderedMembers) {
    const result = await input.update(member, input.nextHyprnav);
    if (result.ok) {
      completed.push(member);
      continue;
    }

    const rollbackFailures: Project[] = [];
    for (const completedMember of completed.toReversed()) {
      const rollback = await input.update(completedMember, completedMember.hyprnav ?? null);
      if (!rollback.ok) rollbackFailures.push(completedMember);
    }
    if (rollbackFailures.length === 0) return result;

    return {
      ok: false,
      error: new Error(
        `${result.error.message} Could not restore ${rollbackFailures.length} already-updated grouped project ${rollbackFailures.length === 1 ? "entry" : "entries"}.`,
      ),
    };
  }

  return { ok: true };
}

export function buildHyprnavPublicationRequests(input: {
  readonly localEnvironmentId: EnvironmentId;
  readonly projects: readonly (Project & { readonly nextHyprnav: ProjectHyprnavSettings })[];
  readonly knownProjects: readonly Project[];
  readonly threadShells: readonly ThreadShell[];
  readonly previousSettingsByProjectKey: ReadonlyMap<string, ProjectHyprnavSettings>;
  readonly publicationHistory?: ReadonlyMap<string, readonly HyprnavPublicationScopeState[]>;
}): DesktopHyprnavSyncInput[] {
  const clearBindingsByProjectKey = new Map(
    input.projects.map((project) => {
      const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
      return [
        key,
        computeRemovedHyprnavBindings(
          input.previousSettingsByProjectKey.get(key),
          project.nextHyprnav,
        ),
      ] as const;
    }),
  );
  const clearNamesByProjectKey = new Map(
    input.projects.map((project) => {
      const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
      return [
        key,
        computeClearedHyprnavBindingNames(
          input.previousSettingsByProjectKey.get(key),
          project.nextHyprnav,
        ),
      ] as const;
    }),
  );

  return buildProjectHyprnavSyncJobs({
    localEnvironmentId: input.localEnvironmentId,
    projects: input.projects.map((project) => ({ ...project, hyprnav: project.nextHyprnav })),
    knownProjects: input.knownProjects,
    threadShells: input.threadShells,
    activeThread: null,
    clearBindingsByProjectKey,
    clearNamesByProjectKey,
  }).map((job) => {
    const request: DesktopHyprnavSyncInput = {
      projectRoot: job.projectRoot,
      worktreePath: job.worktreePath,
      threadId: job.threadId,
      threadTitle: job.threadTitle,
      hyprnav: job.hyprnav,
      clearBindings: job.clearBindings,
      clearNames: job.clearNames,
      lock: job.lock,
    };
    if (!input.publicationHistory) return request;

    const historyCleanup = computeActiveHyprnavCleanup({
      history: input.publicationHistory,
      target: hyprnavPublicationTargetFromRequest(request),
      settings: request.hyprnav,
      scopes: hyprnavPublicationScopesForRequest(request),
    });
    const mergeSlots = (
      left: readonly { readonly scope: ProjectHyprnavScope; readonly slot: number }[],
      right: readonly { readonly scope: ProjectHyprnavScope; readonly slot: number }[],
    ) => [
      ...new Map(
        [...left, ...right].map((binding) => [`${binding.scope}:${String(binding.slot)}`, binding]),
      ).values(),
    ];
    return {
      ...request,
      clearBindings: mergeSlots(request.clearBindings ?? [], historyCleanup.clearBindings),
      clearNames: mergeSlots(request.clearNames ?? [], historyCleanup.clearNames),
    };
  });
}

export async function publishSettingsChange(input: {
  readonly localEnvironmentId: EnvironmentId | null;
  readonly projects: readonly (Project & { readonly nextHyprnav: ProjectHyprnavSettings })[];
  readonly knownProjects: readonly Project[];
  readonly threadShells: readonly ThreadShell[];
  readonly previousSettingsByProjectKey: ReadonlyMap<string, ProjectHyprnavSettings>;
  readonly availableEditors: Parameters<typeof resolveAndPersistPreferredEditor>[0];
  readonly publish?: typeof publishHyprnavRequests;
}): Promise<string> {
  if (input.localEnvironmentId === null || input.projects.length === 0) {
    return "Saved. Runtime synchronization is limited to the primary local environment.";
  }
  try {
    const requests = buildHyprnavPublicationRequests({
      localEnvironmentId: input.localEnvironmentId,
      projects: input.projects,
      knownProjects: input.knownProjects,
      threadShells: input.threadShells,
      previousSettingsByProjectKey: input.previousSettingsByProjectKey,
      publicationHistory: hyprnavPublicationHistory,
    });
    if (requests.length === 0) {
      return "Saved. Runtime synchronization is limited to the primary local environment.";
    }
    const result = await (input.publish ?? publishHyprnavRequests)({
      requests,
      availableEditors: input.availableEditors,
      resolvePreferredEditor: resolveAndPersistPreferredEditor,
      onBeforeSync: (request) => {
        markActiveHyprnavPublicationAttempt({
          history: hyprnavPublicationHistory,
          target: hyprnavPublicationTargetFromRequest(request),
          settings: request.hyprnav,
          scopes: hyprnavPublicationScopesForRequest(request),
        });
        persistHyprnavPublicationHistory(hyprnavPublicationHistory);
      },
      onAfterSync: (request, syncResult) => {
        if (syncResult.status !== "ok") return;
        recordActiveHyprnavPublication({
          history: hyprnavPublicationHistory,
          target: hyprnavPublicationTargetFromRequest(request),
          settings: request.hyprnav,
          appliedScopes: syncResult.appliedScopes ?? hyprnavPublicationScopesForRequest(request),
        });
        persistHyprnavPublicationHistory(hyprnavPublicationHistory);
      },
    });
    return result.status === "ok"
      ? "Saved and synchronized with Hyprnav."
      : `Saved, but Hyprnav was not applied. ${result.message ?? "The desktop runtime will retry later."}`;
  } catch (error) {
    return `Saved, but Hyprnav was not applied. ${
      error instanceof Error ? error.message : "The desktop runtime will retry later."
    }`;
  }
}

function nextBinding(draft: readonly HyprnavDraftBinding[]): HyprnavDraftBinding {
  const used = new Set(draft.map((item) => Number(item.slot)));
  let slot = 1;
  while (used.has(slot)) slot += 1;
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    slot: String(slot),
    scope: "worktree",
    workspaceMode: "managed",
    workspaceId: "",
    name: "",
    action: "shell-command",
    command: "",
  };
}

function BindingEditor({
  binding,
  disabled,
  onChange,
  onRemove,
}: {
  readonly binding: HyprnavDraftBinding;
  readonly disabled: boolean;
  readonly onChange: (next: HyprnavDraftBinding) => void;
  readonly onRemove: () => void;
}) {
  const patch = (value: Partial<HyprnavDraftBinding>) => onChange({ ...binding, ...value });
  return (
    <div className="border-t border-border/60 px-4 py-4 first:border-t-0 sm:px-5">
      <div className="grid gap-3 lg:grid-cols-[5rem_9rem_10rem_minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          Slot
          <Input
            aria-label={`Slot for ${binding.name || binding.id}`}
            inputMode="numeric"
            value={binding.slot}
            disabled={disabled}
            onChange={(event) => patch({ slot: event.target.value })}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          Scope
          <Select
            value={binding.scope}
            disabled={disabled}
            onValueChange={(value) => patch({ scope: value as ProjectHyprnavScope })}
          >
            <SelectTrigger aria-label={`Scope for ${binding.name || binding.id}`}>
              <SelectValue>{findHyprnavScopeLabel(binding.scope)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {HYPRNAV_SCOPE_ROWS.map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          Workspace
          <Select
            value={binding.workspaceMode}
            disabled={disabled}
            onValueChange={(value) =>
              patch({ workspaceMode: value as ProjectHyprnavWorkspaceTarget["mode"] })
            }
          >
            <SelectTrigger aria-label={`Workspace for ${binding.name || binding.id}`}>
              <SelectValue>{findHyprnavWorkspaceLabel(binding.workspaceMode)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {HYPRNAV_WORKSPACE_ROWS.map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          Action
          <Select
            value={binding.action}
            disabled={disabled}
            onValueChange={(value) => patch({ action: value as ProjectHyprnavAction })}
          >
            <SelectTrigger aria-label={`Action for ${binding.name || binding.id}`}>
              <SelectValue>{findHyprnavActionLabel(binding.action)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {HYPRNAV_ACTION_ROWS.map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${binding.name || binding.id}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <MinusIcon className="size-4" />
        </Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          Name
          <Input
            aria-label={`Name for ${binding.id}`}
            placeholder="Optional Hyprnav label"
            maxLength={255}
            value={binding.name}
            disabled={disabled}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        {binding.workspaceMode === "absolute" ? (
          <label className="grid gap-1.5 text-xs font-medium text-foreground">
            Workspace number
            <Input
              aria-label={`Absolute workspace for ${binding.name || binding.id}`}
              inputMode="numeric"
              value={binding.workspaceId}
              disabled={disabled}
              onChange={(event) => patch({ workspaceId: event.target.value })}
            />
          </label>
        ) : null}
        {binding.action === "shell-command" ? (
          <label className="grid gap-1.5 text-xs font-medium text-foreground sm:col-span-2">
            Command
            <Input
              aria-label={`Command for ${binding.name || binding.id}`}
              className="font-mono text-xs"
              placeholder="Command executed by hyprnav"
              value={binding.command}
              disabled={disabled}
              onChange={(event) => patch({ command: event.target.value })}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function HyprnavEditor({
  title,
  description,
  initialSettings,
  inherited,
  disabled,
  onSave,
  onReset,
  resetSettings,
  context,
  onBusyChange,
}: {
  readonly title: string;
  readonly description: string;
  readonly initialSettings: ProjectHyprnavSettings;
  readonly inherited: boolean;
  readonly disabled: boolean;
  readonly onSave: (settings: ProjectHyprnavSettings) => Promise<string>;
  readonly onReset: (() => Promise<string>) | null;
  readonly resetSettings?: ProjectHyprnavSettings;
  readonly context?: ReactNode;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => hyprnavDraftFromSettings(initialSettings));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const parsed = useMemo(() => parseHyprnavDraft(draft), [draft]);
  const initialSettingsKey = JSON.stringify(initialSettings);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineDraftKeyRef = useRef(JSON.stringify(hyprnavDraftFromSettings(initialSettings)));
  const statusIsWarning =
    status?.includes("not applied") === true || status?.includes("unavailable") === true;

  useEffect(() => {
    const nextDraft = hyprnavDraftFromSettings(initialSettings);
    const nextDraftKey = JSON.stringify(nextDraft);
    const dirty = JSON.stringify(draftRef.current) !== baselineDraftKeyRef.current;
    baselineDraftKeyRef.current = nextDraftKey;
    setStatus(null);
    if (!dirty) setDraft(nextDraft);
    // The serialized key intentionally makes equivalent projection objects a no-op.
  }, [initialSettingsKey]);

  const updateBinding = useCallback((index: number, next: HyprnavDraftBinding) => {
    setDraft((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
  }, []);

  const save = async () => {
    if (!parsed.settings) return;
    setBusy(true);
    onBusyChange?.(true);
    try {
      setStatus(await onSave(parsed.settings));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save Hyprnav settings.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const reset = async () => {
    if (!onReset) return;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const nextStatus = await onReset();
      if (resetSettings) {
        const resetDraft = hyprnavDraftFromSettings(resetSettings);
        baselineDraftKeyRef.current = JSON.stringify(resetDraft);
        setDraft(resetDraft);
      }
      setStatus(nextStatus);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not reset Hyprnav settings.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title={title}
        icon={<RouteIcon className="size-3.5" />}
        headerAction={
          inherited ? (
            <span className="text-[11px] text-muted-foreground">Using global defaults</span>
          ) : null
        }
      >
        {context}
        <div className="border-b border-border/60 px-4 py-3.5 sm:px-5">
          <p className="max-w-[70ch] text-xs text-muted-foreground/80">{description}</p>
        </div>
        {draft.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground">
            No bindings. Add one to assign a Hyprnav slot.
          </div>
        ) : (
          draft.map((binding, index) => (
            <BindingEditor
              key={binding.id}
              binding={binding}
              disabled={disabled || busy}
              onChange={(next) => updateBinding(index, next)}
              onRemove={() =>
                setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          ))
        )}
        <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() => setDraft((current) => [...current, nextBinding(current)])}
          >
            <PlusIcon className="size-3.5" />
            Add binding
          </Button>
          <div className="flex flex-1 items-center gap-2 text-xs">
            {parsed.message ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertTriangleIcon className="size-3.5" />
                {parsed.message}
              </span>
            ) : status ? (
              <span
                className={
                  statusIsWarning
                    ? "inline-flex items-center gap-1.5 text-warning"
                    : "text-muted-foreground"
                }
              >
                {statusIsWarning ? <AlertTriangleIcon className="size-3.5" /> : null}
                {status}
              </span>
            ) : null}
          </div>
          {onReset ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={() => void reset()}
            >
              Use defaults
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={() => setDraft(hyprnavDraftFromSettings(DEFAULT_PROJECT_HYPRNAV_SETTINGS))}
            >
              Reset built-ins
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            aria-label="Save and apply"
            disabled={disabled || busy || !parsed.settings}
            onClick={() => void save()}
          >
            <SaveIcon className="size-3.5" />
            Save and apply
          </Button>
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function HyprnavDefaultsSettingsPanel() {
  const hydrated = useClientSettingsHydrated();
  const settings = usePrimarySettings((value) => value.defaultProjectHyprnavSettings);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const persistSettings = usePersistClientSettings();
  const primaryEnvironment = usePrimaryEnvironment();
  const projects = useProjects();
  const threadShells = useThreadShells();
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);

  return (
    <HyprnavEditor
      title="Hyprnav defaults"
      description="Bindings apply to local desktop projects unless a project has its own override. Project, worktree, and thread scopes may reuse the same slot."
      initialSettings={settings}
      inherited={false}
      disabled={!hydrated}
      onReset={null}
      onSave={async (next) => {
        await persistSettings({ defaultProjectHyprnavSettings: next });
        const localProjects = selectInheritedLocalHyprnavProjects({
          projects,
          groupingSettings,
          primaryEnvironmentId: primaryEnvironment?.environmentId ?? null,
        }).map((project) => ({ ...project, nextHyprnav: next }));
        return publishSettingsChange({
          localEnvironmentId: primaryEnvironment?.environmentId ?? null,
          projects: localProjects,
          knownProjects: projects,
          threadShells,
          previousSettingsByProjectKey: new Map(
            localProjects.map((project) => [
              scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
              settings,
            ]),
          ),
          availableEditors,
        });
      }}
    />
  );
}

export function ProjectHyprnavSettingsPanel({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const hydrated = useClientSettingsHydrated();
  const defaults = usePrimarySettings((value) => value.defaultProjectHyprnavSettings);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const stateByLogicalProjectKey = useClientSettings(
    (settings) => settings.groupedProjectHyprnavStateByLogicalProjectKey,
  );
  const persistClientSettings = usePersistClientSettings();
  const primaryEnvironment = usePrimaryEnvironment();
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const projects = useProjects();
  const threadShells = useThreadShells();
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const modeCoordinatorRef = useRef(createProjectHyprnavModeCoordinator());
  const modeChangeGenerationRef = useRef(0);
  const [modeChangePending, setModeChangePending] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [modeChangeError, setModeChangeError] = useState<string | null>(null);

  if (!project) {
    return (
      <SettingsPageContainer>
        <SettingsSection title="Hyprnav project">
          <div className="px-5 py-8 text-sm text-muted-foreground">Project not found.</div>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  const group = resolveProjectHyprnavGroup({
    selectedProject: project,
    projects,
    groupingSettings,
    stateByLogicalProjectKey,
    primaryEnvironmentId: primaryEnvironment?.environmentId ?? null,
  });
  modeCoordinatorRef.current.reconcile(group.mode);
  const effectiveSettings = resolveProjectHyprnavSettings(group.settingsProject.hyprnav, defaults);
  const inherited =
    group.settingsProject.hyprnav === null || group.settingsProject.hyprnav === undefined;

  const persistToMembers = async (
    hyprnav: ProjectHyprnavOverride,
    saveMembers: readonly Project[],
  ) => {
    const nextSettings = resolveProjectHyprnavSettings(hyprnav, defaults);
    const previousSettingsByProjectKey = new Map(
      saveMembers.map((member) => [
        scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
        resolveProjectHyprnavSettings(member.hyprnav, defaults),
      ]),
    );
    const updateResult = await applyProjectHyprnavGroupChange({
      members: saveMembers,
      primaryEnvironmentId: primaryEnvironment?.environmentId ?? null,
      nextHyprnav: hyprnav,
      update: async (member, memberHyprnav) => {
        const result = await updateProject({
          environmentId: member.environmentId,
          input: { projectId: member.id, hyprnav: memberHyprnav },
        });
        if (result._tag !== "Failure") return { ok: true };
        if (isAtomCommandInterrupted(result)) {
          return { ok: false, error: new Error("Project settings save was interrupted.") };
        }
        const error = squashAtomCommandFailure(result);
        return {
          ok: false,
          error: error instanceof Error ? error : new Error("Could not save project settings."),
        };
      },
    });
    if (!updateResult.ok) {
      throw updateResult.error;
    }
    return publishSettingsChange({
      localEnvironmentId: primaryEnvironment?.environmentId ?? null,
      projects: saveMembers.map((member) => ({ ...member, nextHyprnav: nextSettings })),
      knownProjects: projects,
      threadShells,
      previousSettingsByProjectKey,
      availableEditors,
    });
  };

  const restoreMemberOverrides = async (members: readonly Project[]) => {
    const failures: Error[] = [];
    for (const member of members) {
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, hyprnav: member.hyprnav ?? null },
      });
      if (result._tag !== "Failure") continue;
      if (isAtomCommandInterrupted(result)) {
        failures.push(new Error("Project settings restore was interrupted."));
        continue;
      }
      const error = squashAtomCommandFailure(result);
      failures.push(
        error instanceof Error ? error : new Error("Could not restore project settings."),
      );
    }
    if (failures.length > 0) {
      throw new Error(
        failures.length === 1
          ? failures[0]!.message
          : `${failures.length} project settings restores failed. ${failures[0]!.message}`,
      );
    }

    await publishSettingsChange({
      localEnvironmentId: primaryEnvironment?.environmentId ?? null,
      projects: members.map((member) => ({
        ...member,
        nextHyprnav: resolveProjectHyprnavSettings(member.hyprnav, defaults),
      })),
      knownProjects: projects,
      threadShells,
      previousSettingsByProjectKey: new Map(
        members.map((member) => [
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
          resolveProjectHyprnavSettings(group.sharedSettingsProject.hyprnav, defaults),
        ]),
      ),
      availableEditors,
    });
  };

  const persist = async (hyprnav: ProjectHyprnavOverride) => {
    const saveMode = await modeCoordinatorRef.current.beforeSave(group.mode);
    const saveMembers = saveMode === "same" ? group.groupedMembers : [project];
    return persistToMembers(hyprnav, saveMembers);
  };

  const description =
    group.mode === "same" && group.members.length > 1
      ? `Hyprnav bindings for ${project.workspaceRoot}. This project shares settings with ${group.members.length - 1} other grouped project ${group.members.length === 2 ? "entry" : "entries"}.`
      : `Hyprnav bindings for ${project.workspaceRoot}. Saving an override affects only this project entry.`;

  return (
    <HyprnavEditor
      key={scopedProjectKey(scopeProjectRef(environmentId, projectId))}
      title={project.title}
      description={description}
      initialSettings={effectiveSettings}
      inherited={inherited}
      disabled={!hydrated || modeChangePending}
      onBusyChange={setEditorBusy}
      context={
        group.groupedMembers.length > 1 ? (
          <div className="flex flex-col gap-2 border-b border-border/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="text-xs font-medium text-foreground">Grouped project settings</div>
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                Share one configuration across this sidebar group or edit each project separately.
              </p>
              {modeChangeError ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {modeChangeError}
                </p>
              ) : null}
            </div>
            <Select
              value={group.mode}
              disabled={!hydrated || modeChangePending || editorBusy}
              onValueChange={(value) => {
                const mode = value as GroupedProjectHyprnavState["mode"];
                const generation = ++modeChangeGenerationRef.current;
                setModeChangeError(null);
                setModeChangePending(true);
                const transition = modeCoordinatorRef.current.change(mode, () =>
                  transitionProjectHyprnavMode({
                    mode,
                    synchronizeSameSettings: async () => {
                      await persistToMembers(
                        group.sharedSettingsProject.hyprnav ?? null,
                        group.groupedMembers,
                      );
                    },
                    persistMode: () =>
                      persistClientSettings((currentSettings) => ({
                        groupedProjectHyprnavStateByLogicalProjectKey:
                          updateGroupedProjectHyprnavMode({
                            stateByLogicalProjectKey:
                              currentSettings.groupedProjectHyprnavStateByLogicalProjectKey,
                            logicalProjectKey: group.logicalProjectKey,
                            mode,
                            sharedSettingsProject: group.sharedSettingsProject,
                          }),
                      })),
                    rollbackSameSettings: () => restoreMemberOverrides(group.groupedMembers),
                  }),
                );
                void transition
                  .catch((error) => {
                    if (modeChangeGenerationRef.current === generation) {
                      setModeChangeError(
                        error instanceof Error
                          ? error.message
                          : "Could not change grouped project settings mode.",
                      );
                    }
                  })
                  .finally(() => {
                    if (modeChangeGenerationRef.current === generation) {
                      setModeChangePending(false);
                    }
                  });
              }}
            >
              <SelectTrigger aria-label="Project Hyprnav editing mode" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="same">Same settings</SelectItem>
                <SelectItem value="separate">Separate per project</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        ) : null
      }
      resetSettings={defaults}
      onReset={() => persist(null)}
      onSave={(next) =>
        persist(
          resolveProjectHyprnavNextOverride({
            parsedSettings: next,
            defaultProjectHyprnavSettings: defaults,
            forceInherited: false,
          }),
        )
      }
    />
  );
}
