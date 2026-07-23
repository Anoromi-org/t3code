import { describe, expect, it } from "vite-plus/test";

import {
  replaceProviderOptionSelection,
  resolveFastModeDescriptor,
  resolveReasoningDescriptor,
  toggleFastModeOptionSelection,
} from "./composerSlashActions";

const capabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select" as const,
      options: [
        { id: "normal", label: "Normal", isDefault: true },
        { id: "high", label: "High" },
      ],
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select" as const,
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ],
      currentValue: "default",
    },
  ],
};

describe("composer slash actions", () => {
  it("uses the provider's live reasoning choices and default", () => {
    expect(resolveReasoningDescriptor({ capabilities, selections: undefined })).toMatchObject({
      id: "effort",
      currentValue: "normal",
      options: [
        { id: "normal", label: "Normal", isDefault: true },
        { id: "high", label: "High" },
      ],
    });
  });

  it("applies the persisted reasoning selection", () => {
    expect(
      resolveReasoningDescriptor({
        capabilities,
        selections: [{ id: "effort", value: "high" }],
      })?.currentValue,
    ).toBe("high");
  });

  it("finds fast mode and preserves unrelated selections when updating", () => {
    expect(resolveFastModeDescriptor({ capabilities, selections: undefined })).toMatchObject({
      id: "serviceTier",
      currentValue: false,
      enabledValue: "priority",
      disabledValue: "default",
    });
    expect(
      replaceProviderOptionSelection(
        [
          { id: "effort", value: "normal" },
          { id: "contextWindow", value: "long" },
        ],
        { id: "effort", value: "high" },
      ),
    ).toEqual([
      { id: "contextWindow", value: "long" },
      { id: "effort", value: "high" },
    ]);
  });

  it("toggles fast mode while preserving unrelated selections", () => {
    const selections = [
      { id: "effort", value: "high" },
      { id: "contextWindow", value: "long" },
    ];
    const enabled = toggleFastModeOptionSelection({ capabilities, selections });
    expect(enabled).toEqual([...selections, { id: "serviceTier", value: "priority" }]);
    expect(toggleFastModeOptionSelection({ capabilities, selections: enabled })).toEqual([
      ...selections,
      { id: "serviceTier", value: "default" },
    ]);
  });

  it("does not claim fast mode when the model has no live descriptor", () => {
    expect(
      toggleFastModeOptionSelection({
        capabilities: { optionDescriptors: capabilities.optionDescriptors.slice(0, 1) },
        selections: [{ id: "effort", value: "high" }],
      }),
    ).toBeNull();
  });

  it("does not claim a non-boolean descriptor named fastMode", () => {
    expect(
      toggleFastModeOptionSelection({
        capabilities: {
          optionDescriptors: [
            {
              id: "fastMode",
              label: "Fast mode",
              type: "select",
              options: [{ id: "fast", label: "Fast", isDefault: true }],
            },
          ],
        },
        selections: [],
      }),
    ).toBeNull();
  });

  it("keeps legacy boolean fast-mode descriptors working", () => {
    const legacyCapabilities = {
      optionDescriptors: [
        { id: "fastMode", label: "Fast mode", type: "boolean" as const, currentValue: false },
      ],
    };
    expect(
      toggleFastModeOptionSelection({ capabilities: legacyCapabilities, selections: [] }),
    ).toEqual([{ id: "fastMode", value: true }]);
  });

  it("does not infer fast mode from a service tier without a fast option", () => {
    expect(
      toggleFastModeOptionSelection({
        capabilities: {
          optionDescriptors: [
            {
              id: "serviceTier",
              label: "Service Tier",
              type: "select",
              options: [
                { id: "default", label: "Standard", isDefault: true },
                { id: "flex", label: "Flex" },
              ],
            },
          ],
        },
        selections: [],
      }),
    ).toBeNull();
  });
});
