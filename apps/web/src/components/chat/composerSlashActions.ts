import type {
  ModelCapabilities,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

const REASONING_DESCRIPTOR_IDS = new Set(["reasoningEffort", "reasoning", "effort"]);

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
