import * as NodeFS from "node:fs";
import type { ExpoConfig } from "expo/config";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import easConfig from "./eas.json";
import {
  UPSTREAM_APP_STORE_CONNECT_ID,
  validateForkAppStoreConnectId,
} from "./scripts/configure-app-store-submission.mjs";

const originalEnvironment = { ...process.env };
const forkProjectId = "79b50362-2e5d-4048-94ca-c2f82bf7e452";
const productionWorkflow = NodeFS.readFileSync(
  new URL("../../.github/workflows/mobile-eas-production.yml", import.meta.url),
  "utf8",
);

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnvironment);
}

async function loadConfig(input: {
  readonly variant: "development" | "preview" | "production";
  readonly personalBundleIdentifier?: string;
  readonly relyingParty?: string;
}): Promise<ExpoConfig> {
  vi.resetModules();
  process.env.APP_VARIANT = input.variant;
  process.env.T3CODE_IOS_PERSONAL_TEAM = input.personalBundleIdentifier ? "1" : "0";
  process.env.T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID = input.personalBundleIdentifier ?? "";
  process.env.T3CODE_IOS_RELYING_PARTY = input.relyingParty ?? "";
  return (await import("./app.config.ts")).default;
}

function plugin(
  config: ExpoConfig,
  name: string,
): readonly [string, Record<string, unknown>] | null {
  const entry = config.plugins?.find((candidate) =>
    Array.isArray(candidate) ? candidate[0] === name : candidate === name,
  );
  return Array.isArray(entry)
    ? (entry as unknown as readonly [string, Record<string, unknown>])
    : null;
}

afterEach(() => {
  restoreEnvironment();
  vi.resetModules();
});

describe("mobile release configuration", () => {
  const variants = [
    {
      variant: "development" as const,
      name: "T3 Code Dev",
      scheme: "t3code-dev",
      iosBundleIdentifier: "com.anoromi.t3code.dev",
      androidPackage: "com.t3tools.t3code.dev",
      assetMarker: "/dev/",
    },
    {
      variant: "preview" as const,
      name: "T3 Code Preview",
      scheme: "t3code-preview",
      iosBundleIdentifier: "com.anoromi.t3code.preview",
      androidPackage: "com.t3tools.t3code.preview",
      assetMarker: "/nightly/",
    },
    {
      variant: "production" as const,
      name: "T3 Code",
      scheme: "t3code",
      iosBundleIdentifier: "com.anoromi.t3code",
      androidPackage: "com.t3tools.t3code",
      assetMarker: "/prod/",
    },
  ];

  for (const expected of variants) {
    it(`uses fork identity and upstream platform configuration for ${expected.variant}`, async () => {
      const config = await loadConfig({ variant: expected.variant });
      const widgets = plugin(config, "expo-widgets");

      expect(config).toMatchObject({
        name: expected.name,
        scheme: expected.scheme,
        platforms: ["ios", "android"],
        owner: "anoromi",
        updates: { url: `https://u.expo.dev/${forkProjectId}` },
        ios: {
          bundleIdentifier: expected.iosBundleIdentifier,
          appleTeamId: "B3R2UG339G",
          associatedDomains: [],
        },
        android: {
          package: expected.androidPackage,
          predictiveBackGestureEnabled: true,
        },
        extra: {
          appVariant: expected.variant,
          iosPersonalTeamBuild: false,
          eas: { projectId: forkProjectId },
        },
      });
      expect(config.icon).toContain(expected.assetMarker);
      expect(config.ios?.icon).toContain(expected.assetMarker);
      expect(config.android?.icon).toContain(expected.assetMarker);
      expect(widgets?.[1]).toMatchObject({
        bundleIdentifier: `${expected.iosBundleIdentifier}.widgets`,
        groupIdentifier: `group.${expected.iosBundleIdentifier}`,
      });
      expect(plugin(config, "expo-sharing")?.[1]).toMatchObject({
        ios: { enabled: true },
        android: { enabled: true },
      });
    });
  }

  it("retains the personal-team bundle and reduced-capability override", async () => {
    const personalBundleIdentifier = "com.example.personal.t3code";
    const config = await loadConfig({
      variant: "development",
      personalBundleIdentifier,
      relyingParty: "clerk.example.com",
    });

    expect(config.ios).toMatchObject({
      bundleIdentifier: personalBundleIdentifier,
      appleTeamId: "B3R2UG339G",
      associatedDomains: [],
    });
    expect(config.android?.package).toBe("com.t3tools.t3code.dev");
    expect(config.extra).toMatchObject({ iosPersonalTeamBuild: true });
    expect(plugin(config, "expo-sharing")?.[1]).toMatchObject({
      ios: {
        enabled: false,
        extensionBundleIdentifier: `${personalBundleIdentifier}.sharing`,
        appGroupId: `group.${personalBundleIdentifier}`,
      },
      android: { enabled: true },
    });
    expect(config.plugins).toContain("./plugins/withoutIosPersonalTeamCapabilities.cjs");
    expect(config.plugins).not.toContain("./plugins/withWidgetLogoAsset.cjs");
    expect(plugin(config, "expo-widgets")).toBeNull();
    expect(plugin(config, "@clerk/expo")?.[1]).toMatchObject({ appleSignIn: false });
  });

  it("enables associated domains only for an explicitly configured authorized host", async () => {
    const config = await loadConfig({
      variant: "production",
      relyingParty: "clerk.example.com",
    });

    expect(config.ios?.associatedDomains).toEqual([
      "applinks:clerk.example.com",
      "webcredentials:clerk.example.com",
    ]);
  });

  it("does not retain the upstream App Store Connect submission target", () => {
    expect(easConfig.submit.production.ios).toEqual({});
    expect(easConfig.submit.production.android).toEqual({ track: "internal" });
    expect(productionWorkflow).not.toContain("6787819824");
    expect(productionWorkflow).toContain(
      "MOBILE_IOS_ASC_APP_ID: ${{ vars.MOBILE_IOS_ASC_APP_ID }}",
    );
    expect(productionWorkflow).toContain(
      'node scripts/configure-app-store-submission.mjs "$MOBILE_IOS_ASC_APP_ID"',
    );
    expect(productionWorkflow).toContain(
      "(github.event_name == 'push' ||\n            (inputs.mode == 'build' && inputs.platform != 'android'))",
    );
    expect(productionWorkflow).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.mode == 'build'",
    );
    expect(productionWorkflow).toContain(
      "eas build --platform ${{ inputs.platform }} --profile production --auto-submit --non-interactive --no-wait",
    );
  });

  it("validates the injected App Store target", () => {
    expect(validateForkAppStoreConnectId(" 1234567890 ")).toBe("1234567890");
    expect(() => validateForkAppStoreConnectId("not-an-id")).toThrow(
      "must contain the fork App Store Connect numeric Apple ID",
    );
    expect(() => validateForkAppStoreConnectId(UPSTREAM_APP_STORE_CONNECT_ID)).toThrow(
      "must not target the upstream T3 Code App Store record",
    );
  });

  it("rejects a personal-team build without a valid bundle identifier", async () => {
    vi.resetModules();
    process.env.APP_VARIANT = "development";
    process.env.T3CODE_IOS_PERSONAL_TEAM = "1";
    process.env.T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID = "invalid";

    await expect(import("./app.config.ts")).rejects.toThrow(
      "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS identifier",
    );
  });

  it("rejects an iOS relying party that is not a hostname", async () => {
    vi.resetModules();
    process.env.APP_VARIANT = "production";
    process.env.T3CODE_IOS_PERSONAL_TEAM = "0";
    process.env.T3CODE_IOS_RELYING_PARTY = "https://clerk.example.com/path";

    await expect(import("./app.config.ts")).rejects.toThrow(
      "T3CODE_IOS_RELYING_PARTY must be a hostname",
    );
  });
});
