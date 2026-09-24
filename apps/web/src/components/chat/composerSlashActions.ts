import type {
  ModelCapabilities,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  VcsRef,
} from "@t3tools/contracts";
import { deriveLocalBranchNameFromRemoteRef } from "@t3tools/shared/git";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import { withImplicitFastModeDefault } from "./composerProviderState";

const REASONING_DESCRIPTOR_IDS = new Set(["reasoningEffort", "reasoning", "effort"]);
const FAST_SERVICE_TIER_IDS = new Set(["priority", "fast"]);

/** The local branch a `/worktree <ref>` worktree checks out: remote refs map to their local name. */
export function resolveWorktreeTargetBranchName(branch: Pick<VcsRef, "isRemote" | "name">) {
  return branch.isRemote ? deriveLocalBranchNameFromRemoteRef(branch.name) : branch.name;
}

/** Fast mode as a two-state toggle over either a boolean or a service-tier option. */
interface FastModeDescriptor {
  readonly id: string;
  readonly currentValue: boolean;
  readonly enabledValue: boolean | string;
  readonly disabledValue: boolean | string;
}

/** Live reasoning select for `/reasoning`, with the draft's selection applied. */
export function resolveReasoningDescriptor(input: {
  capabilities: ModelCapabilities;
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): Extract<ProviderOptionDescriptor, { type: "select" }> | null {
  const descriptors = getProviderOptionDescriptors({
    caps: input.capabilities,
    selections: input.selections,
  });
  return (
    descriptors.find(
      (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
        descriptor.type === "select" && REASONING_DESCRIPTOR_IDS.has(descriptor.id),
    ) ?? null
  );
}

/**
 * Live fast-mode control for `/fast`: the legacy boolean `fastMode` option or
 * a `serviceTier` select with Fast and Standard tiers. Selections resolve like
 * the traits picker, so a provider that defaults to Fast still reads as off
 * until the user picks it.
 */
export function resolveFastModeDescriptor(input: {
  capabilities: ModelCapabilities;
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): FastModeDescriptor | null {
  const descriptors = getProviderOptionDescriptors({
    caps: input.capabilities,
    selections: withImplicitFastModeDefault(input.capabilities, input.selections),
  });
  const booleanDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
      descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  if (booleanDescriptor) {
    return {
      id: booleanDescriptor.id,
      currentValue: booleanDescriptor.currentValue === true,
      enabledValue: true,
      disabledValue: false,
    };
  }

  const serviceTierDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select" && descriptor.id === "serviceTier",
  );
  if (!serviceTierDescriptor) return null;
  const fastOption = serviceTierDescriptor.options.find(
    (option) =>
      FAST_SERVICE_TIER_IDS.has(option.id) || option.label.trim().toLowerCase() === "fast",
  );
  const standardOption =
    serviceTierDescriptor.options.find((option) => option.id === "default") ??
    serviceTierDescriptor.options.find(
      (option) => option.isDefault && option.id !== fastOption?.id,
    );
  if (!fastOption || !standardOption) return null;

  return {
    id: serviceTierDescriptor.id,
    currentValue: serviceTierDescriptor.currentValue === fastOption.id,
    enabledValue: fastOption.id,
    disabledValue: standardOption.id,
  };
}

/** Next selections with fast mode flipped, or null when the model has no fast control. */
export function toggleFastModeOptionSelection(input: {
  capabilities: ModelCapabilities;
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): ProviderOptionSelection[] | null {
  const descriptor = resolveFastModeDescriptor(input);
  if (!descriptor) return null;

  return replaceProviderOptionSelection(input.selections, {
    id: descriptor.id,
    value: descriptor.currentValue ? descriptor.disabledValue : descriptor.enabledValue,
  });
}

/** Replaces one option selection while preserving the others. */
export function replaceProviderOptionSelection(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  nextSelection: ProviderOptionSelection,
): ProviderOptionSelection[] {
  return [
    ...(selections ?? []).filter((selection) => selection.id !== nextSelection.id),
    nextSelection,
  ];
}
