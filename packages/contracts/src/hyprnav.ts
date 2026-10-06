import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProjectHyprnavAction = Schema.Literals([
  "worktree-terminal",
  "open-favorite-editor",
  "nothing",
  "shell-command",
]);
export type ProjectHyprnavAction = typeof ProjectHyprnavAction.Type;

export const ProjectHyprnavScope = Schema.Literals(["project", "worktree", "thread"]);
export type ProjectHyprnavScope = typeof ProjectHyprnavScope.Type;

export const PROJECT_HYPRNAV_WORKTREE_TERMINAL_ID = "worktree-terminal";
export const PROJECT_HYPRNAV_OPEN_FAVORITE_EDITOR_ID = "open-favorite-editor";
export const PROJECT_HYPRNAV_CORKDIFF_ID = "corkdiff-viewer";
export const PROJECT_HYPRNAV_CORKDIFF_COMMAND_TEMPLATE = "{corkdiffLaunchCommand}";

export const ProjectHyprnavManagedWorkspaceTarget = Schema.Struct({
  mode: Schema.Literal("managed"),
});
export type ProjectHyprnavManagedWorkspaceTarget = typeof ProjectHyprnavManagedWorkspaceTarget.Type;

export const ProjectHyprnavAbsoluteWorkspaceTarget = Schema.Struct({
  mode: Schema.Literal("absolute"),
  workspaceId: PositiveInt,
});
export type ProjectHyprnavAbsoluteWorkspaceTarget =
  typeof ProjectHyprnavAbsoluteWorkspaceTarget.Type;

export const ProjectHyprnavWorkspaceTarget = Schema.Union([
  ProjectHyprnavManagedWorkspaceTarget,
  ProjectHyprnavAbsoluteWorkspaceTarget,
]);
export type ProjectHyprnavWorkspaceTarget = typeof ProjectHyprnavWorkspaceTarget.Type;

export const DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET = {
  mode: "managed",
} as const satisfies ProjectHyprnavWorkspaceTarget;

const ProjectHyprnavWorkspaceTargetInput = Schema.optional(ProjectHyprnavWorkspaceTarget).pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET)),
);

const ProjectHyprnavBuiltinAction = Schema.Literals([
  "worktree-terminal",
  "open-favorite-editor",
  "nothing",
]);

export const ProjectHyprnavBuiltinBinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  slot: PositiveInt,
  scope: ProjectHyprnavScope,
  workspace: ProjectHyprnavWorkspaceTarget,
  name: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  action: ProjectHyprnavBuiltinAction,
});
export type ProjectHyprnavBuiltinBinding = typeof ProjectHyprnavBuiltinBinding.Type;

export const ProjectHyprnavShellCommandBinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  slot: PositiveInt,
  scope: ProjectHyprnavScope,
  workspace: ProjectHyprnavWorkspaceTarget,
  name: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  action: Schema.Literal("shell-command"),
  command: TrimmedNonEmptyString,
});
export type ProjectHyprnavShellCommandBinding = typeof ProjectHyprnavShellCommandBinding.Type;

const ProjectHyprnavBuiltinBindingInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  slot: PositiveInt,
  scope: Schema.optional(ProjectHyprnavScope).pipe(
    Schema.withDecodingDefault(Effect.succeed("worktree")),
  ),
  workspace: ProjectHyprnavWorkspaceTargetInput,
  name: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  action: ProjectHyprnavBuiltinAction,
});
type ProjectHyprnavBuiltinBindingInput = typeof ProjectHyprnavBuiltinBindingInput.Type;

const ProjectHyprnavShellCommandBindingInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  slot: PositiveInt,
  scope: Schema.optional(ProjectHyprnavScope).pipe(
    Schema.withDecodingDefault(Effect.succeed("worktree")),
  ),
  workspace: ProjectHyprnavWorkspaceTargetInput,
  name: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  action: Schema.Literal("shell-command"),
  command: TrimmedNonEmptyString,
});
type ProjectHyprnavShellCommandBindingInput = typeof ProjectHyprnavShellCommandBindingInput.Type;

const ProjectHyprnavBindingInput = Schema.Union([
  ProjectHyprnavBuiltinBindingInput,
  ProjectHyprnavShellCommandBindingInput,
]);
type ProjectHyprnavBindingInput = typeof ProjectHyprnavBindingInput.Type;

export const ProjectHyprnavBinding = Schema.Union([
  ProjectHyprnavBuiltinBinding,
  ProjectHyprnavShellCommandBinding,
]);
export type ProjectHyprnavBinding = typeof ProjectHyprnavBinding.Type;

const ProjectHyprnavSettingsCanonical = Schema.Struct({
  bindings: Schema.Array(ProjectHyprnavBinding),
});
type ProjectHyprnavSettingsCanonical = typeof ProjectHyprnavSettingsCanonical.Type;

export const DEFAULT_PROJECT_HYPRNAV_SETTINGS = {
  bindings: [
    {
      id: PROJECT_HYPRNAV_WORKTREE_TERMINAL_ID,
      slot: 1,
      scope: "worktree",
      workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
      action: "worktree-terminal",
    },
    {
      id: PROJECT_HYPRNAV_OPEN_FAVORITE_EDITOR_ID,
      slot: 2,
      scope: "worktree",
      workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
      action: "open-favorite-editor",
    },
    {
      id: PROJECT_HYPRNAV_CORKDIFF_ID,
      slot: 8,
      scope: "thread",
      workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
      action: "shell-command",
      command: PROJECT_HYPRNAV_CORKDIFF_COMMAND_TEMPLATE,
    },
  ],
} as const satisfies ProjectHyprnavSettingsCanonical;

const LegacyNullableProjectHyprnavCommand = Schema.NullOr(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
);
const LegacyNullableProjectHyprnavSlot = Schema.NullOr(PositiveInt).pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
);
const LegacyProjectHyprnavActionBinding = Schema.Struct({
  slot: LegacyNullableProjectHyprnavSlot,
  command: LegacyNullableProjectHyprnavCommand,
});
type LegacyProjectHyprnavActionBinding = typeof LegacyProjectHyprnavActionBinding.Type;
const LegacyProjectHyprnavSettings = Schema.Struct({
  bindings: Schema.optionalKey(Schema.Never),
  terminalWorktree: LegacyProjectHyprnavActionBinding.pipe(
    Schema.withDecodingDefault(Effect.succeed({ slot: 1, command: null })),
  ),
  openFavorite: LegacyProjectHyprnavActionBinding.pipe(
    Schema.withDecodingDefault(Effect.succeed({ slot: 2, command: null })),
  ),
  corkdiff: LegacyProjectHyprnavActionBinding.pipe(
    Schema.withDecodingDefault(Effect.succeed({ slot: null, command: null })),
  ),
});
type LegacyProjectHyprnavSettings = typeof LegacyProjectHyprnavSettings.Type;

function legacyBuiltinBinding(input: {
  readonly id: string;
  readonly action: "worktree-terminal" | "open-favorite-editor";
  readonly binding: LegacyProjectHyprnavActionBinding;
}): ProjectHyprnavBinding[] {
  if (input.binding.slot === null) return [];
  if (input.binding.command !== null) {
    return [
      {
        id: `${input.id}-command`,
        slot: input.binding.slot,
        scope: "worktree",
        workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
        action: "shell-command",
        command: input.binding.command,
      },
    ];
  }
  return [
    {
      id: input.id,
      slot: input.binding.slot,
      scope: "worktree",
      workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
      action: input.action,
    },
  ];
}

function legacyCorkdiffBinding(
  binding: LegacyProjectHyprnavActionBinding,
): ProjectHyprnavBinding[] {
  if (binding.slot === null) return [];
  return [
    {
      id: PROJECT_HYPRNAV_CORKDIFF_ID,
      slot: binding.slot,
      scope: "thread",
      workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
      action: "shell-command",
      command: binding.command ?? PROJECT_HYPRNAV_CORKDIFF_COMMAND_TEMPLATE,
    },
  ];
}

function normalizeProjectHyprnavSettings(
  input:
    | { readonly bindings: readonly ProjectHyprnavBindingInput[] }
    | LegacyProjectHyprnavSettings,
): ProjectHyprnavSettingsCanonical {
  if ("terminalWorktree" in input) {
    const bindings = [
      ...legacyBuiltinBinding({
        id: PROJECT_HYPRNAV_WORKTREE_TERMINAL_ID,
        action: "worktree-terminal",
        binding: input.terminalWorktree,
      }),
      ...legacyBuiltinBinding({
        id: PROJECT_HYPRNAV_OPEN_FAVORITE_EDITOR_ID,
        action: "open-favorite-editor",
        binding: input.openFavorite,
      }),
      ...legacyCorkdiffBinding(input.corkdiff),
    ];
    return {
      bindings: bindings.some((binding) => binding.id === PROJECT_HYPRNAV_CORKDIFF_ID)
        ? bindings
        : [
            ...bindings,
            ...DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.filter(
              (binding) => binding.id === PROJECT_HYPRNAV_CORKDIFF_ID,
            ),
          ],
    };
  }
  return {
    bindings: input.bindings.map((binding) => ({
      ...binding,
      scope: binding.scope ?? "worktree",
      workspace: binding.workspace ?? DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
    })),
  };
}

const ProjectHyprnavSettingsInput = Schema.Union([
  Schema.Struct({ bindings: Schema.Array(ProjectHyprnavBindingInput) }),
  LegacyProjectHyprnavSettings,
]);

export const ProjectHyprnavSettings = ProjectHyprnavSettingsInput.pipe(
  Schema.decodeTo(
    Schema.toType(ProjectHyprnavSettingsCanonical),
    SchemaTransformation.transformOrFail({
      decode: (input) => Effect.succeed(normalizeProjectHyprnavSettings(input)),
      encode: (settings) => Effect.succeed(settings),
    }),
  ),
);
export type ProjectHyprnavSettings = typeof ProjectHyprnavSettings.Type;

export const ProjectHyprnavOverride = Schema.NullOr(ProjectHyprnavSettings);
export type ProjectHyprnavOverride = typeof ProjectHyprnavOverride.Type;

export const HyprnavBrowserKind = Schema.Literals(["chromium", "firefox"]);
export type HyprnavBrowserKind = typeof HyprnavBrowserKind.Type;

/**
 * Where a browser slot's per-thread query value comes from. `checkout` is the
 * absolute directory the thread works in (its worktree, else the project
 * root), which identifies it across projects. `branch` is the thread's branch;
 * threads without one get no browser slot.
 */
export const HyprnavBrowserSlotValueSource = Schema.Literals(["checkout", "branch"]);
export type HyprnavBrowserSlotValueSource = typeof HyprnavBrowserSlotValueSource.Type;

/**
 * A global slot every thread's hyprnav environment gets: going to it switches
 * to the fixed `workspace` and points the named browser tab at
 * `url?<param>=<thread value>`.
 */
export const HyprnavBrowserSlot = Schema.Struct({
  slot: PositiveInt,
  workspace: PositiveInt,
  browser: HyprnavBrowserKind.pipe(Schema.withDecodingDefaultKey(Effect.succeed("chromium"))),
  tabName: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  param: TrimmedNonEmptyString.pipe(Schema.withDecodingDefaultKey(Effect.succeed("checkout"))),
  value: HyprnavBrowserSlotValueSource.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("checkout")),
  ),
});
export type HyprnavBrowserSlot = typeof HyprnavBrowserSlot.Type;

/**
 * hyprnav's `locked` event: the daemon's locked environment changed, or (with
 * `cause: "snapshot"`) the current value on connect. Forwarded verbatim over
 * `/api/hyprnav/events`.
 */
export interface HyprnavLockedEvent {
  readonly event: "locked";
  readonly ts_ms: number;
  readonly seq: number;
  readonly locked_environment_id: string | null;
  readonly previous_environment_id: string | null;
  /** `snapshot`, or the request op / `focus` / `env_delete` that moved the lock. */
  readonly cause: string;
  /** The `--origin` tag of the request that moved the lock; T3 sends `t3code`. */
  readonly origin: string | null;
  readonly environment: {
    readonly title: string | null;
    readonly cwd: string | null;
    readonly chain: ReadonlyArray<string>;
  } | null;
}

export type ParsedHyprnavEnvironmentId =
  | { readonly scope: "thread"; readonly threadId: string }
  | { readonly scope: "worktree" | "project" };

const HYPRNAV_T3_ENVIRONMENT_ID = /^p\.[0-9a-f]{12}(\.w\.[0-9a-f]{12}(\.t\.(.+))?)?$/u;

/**
 * Reads back an environment id T3 published (`p.<hash>[.w.<hash>[.t.<threadId>]]`,
 * built by the desktop's `buildHyprnavEnvironmentIds`). `null` for any other env.
 */
export function parseHyprnavEnvironmentId(id: string): ParsedHyprnavEnvironmentId | null {
  const match = HYPRNAV_T3_ENVIRONMENT_ID.exec(id);
  if (!match) return null;
  if (match[3] !== undefined) return { scope: "thread", threadId: match[3] };
  return { scope: match[1] !== undefined ? "worktree" : "project" };
}
