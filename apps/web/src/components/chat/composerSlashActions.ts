import type {
  ModelCapabilities,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

const REASONING_DESCRIPTOR_IDS = new Set(["reasoningEffort", "reasoning", "effort"]);

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
}): Extract<ProviderOptionDescriptor, { type: "boolean" }> | null {
  const descriptors = getProviderOptionDescriptors({
    caps: input.capabilities,
    selections: input.selections,
  });
  return (
    descriptors.find(
      (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
        descriptor.type === "boolean" && descriptor.id === "fastMode",
    ) ?? null
  );
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
