import { describe, expect, it } from "vite-plus/test";

import { replaceProviderOptionSelection, resolveReasoningDescriptor } from "./composerSlashActions";

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

  it("preserves unrelated selections when replacing one", () => {
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
});
