import type {
  ModelCapabilities,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

const REASONING_DESCRIPTOR_IDS = new Set(["reasoningEffort", "reasoning", "effort"]);
const FAST_SERVICE_TIER_IDS = new Set(["priority", "fast"]);

export interface FastModeDescriptor {
  readonly id: string;
  readonly currentValue: boolean;
  readonly enabledValue: boolean | string;
  readonly disabledValue: boolean | string;
}

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

export function resolveFastModeDescriptor(input: {
  capabilities: ModelCapabilities;
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): FastModeDescriptor | null {
  const descriptors = getProviderOptionDescriptors({
    caps: input.capabilities,
    selections: input.selections,
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

export function replaceProviderOptionSelection(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  nextSelection: ProviderOptionSelection,
): ProviderOptionSelection[] {
  return [
    ...(selections ?? []).filter((selection) => selection.id !== nextSelection.id),
    nextSelection,
  ];
}
