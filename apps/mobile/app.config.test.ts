import * as NodeFS from "node:fs";

import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import type { ExpoConfig } from "expo/config";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";
import easConfig from "./eas.json";
import {
  UPSTREAM_APP_STORE_CONNECT_ID,
  validateForkAppStoreConnectId,
} from "./scripts/configure-app-store-submission.mjs";

const CONFIG_ENV_KEYS = [
  "APP_VARIANT",
  "T3CODE_MOBILE_UPDATES_ENABLED",
  "T3CODE_IOS_PERSONAL_TEAM",
  "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID",
  "T3CODE_IOS_RELYING_PARTY",
] as const;

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () =>
    Object.fromEntries(
      CONFIG_ENV_KEYS.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    ),
}));

const forkProjectId = "79b50362-2e5d-4048-94ca-c2f82bf7e452";
const productionWorkflow = NodeFS.readFileSync(
  new URL("../../.github/workflows/mobile-eas-production.yml", import.meta.url),
  "utf8",
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

async function loadReleaseConfig(input: {
  readonly variant: "development" | "preview" | "production";
  readonly personalBundleIdentifier?: string;
  readonly relyingParty?: string;
}): Promise<ExpoConfig> {
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "1");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", input.personalBundleIdentifier ? "1" : "0");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID", input.personalBundleIdentifier ?? "");
  vi.stubEnv("T3CODE_IOS_RELYING_PARTY", input.relyingParty ?? "");
  return loadConfig(input.variant);
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

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.anoromi.t3code", "com.t3tools.t3code"],
  ["development", "com.anoromi.t3code.dev", "com.t3tools.t3code.dev"],
  ["preview", "com.anoromi.t3code.preview", "com.t3tools.t3code.preview"],
  ["production", "com.anoromi.t3code", "com.t3tools.t3code"],
])(
  "keeps the iOS and Android identifiers for APP_VARIANT=%j",
  async (value, iosIdentifier, androidIdentifier) => {
    const config = await loadConfig(value);
    expect(config.ios?.bundleIdentifier).toBe(iosIdentifier);
    expect(config.android?.package).toBe(androidIdentifier);
    // app.t3.codes lists upstream's apps only, so the fork's iOS identity must not claim it.
    const host = new URL(DEFAULT_HOSTED_APP_URL).host;
    expect(config.ios?.associatedDomains).not.toContain(`applinks:${host}`);
    expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).not.toContain(
      `${config.ios?.appleTeamId}.${iosIdentifier}`,
    );
    expect(config.android?.intentFilters?.[0]?.data).toEqual([
      { scheme: "https", host, pathPrefix: "/threads/" },
    ]);
    expect(assetLinks.map((link) => link.target.package_name)).toContain(androidIdentifier);
  },
);

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

  it.each(variants)(
    "uses fork identity and upstream platform configuration for $variant",
    async (expected) => {
      const config = await loadReleaseConfig({ variant: expected.variant });
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
          entitlements: {
            "keychain-access-groups": [`$(AppIdentifierPrefix)${expected.iosBundleIdentifier}`],
          },
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
    },
  );

  it("retains the personal-team bundle and reduced-capability override", async () => {
    const personalBundleIdentifier = "com.example.personal.t3code";
    const config = await loadReleaseConfig({
      variant: "development",
      personalBundleIdentifier,
      relyingParty: "clerk.example.com",
    });

    expect(config.ios).toMatchObject({
      bundleIdentifier: personalBundleIdentifier,
      appleTeamId: "B3R2UG339G",
      associatedDomains: [],
      entitlements: {
        "keychain-access-groups": [`$(AppIdentifierPrefix)${personalBundleIdentifier}`],
      },
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
    const config = await loadReleaseConfig({
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
    expect(productionWorkflow).not.toContain(UPSTREAM_APP_STORE_CONNECT_ID);
    expect(productionWorkflow).toContain(
      "MOBILE_IOS_ASC_APP_ID: ${{ vars.MOBILE_IOS_ASC_APP_ID }}",
    );
    expect(productionWorkflow).toContain(
      'node scripts/configure-app-store-submission.mjs "$MOBILE_IOS_ASC_APP_ID"',
    );
    expect(productionWorkflow).toContain(
      'eas submit --platform ios --profile "$PROFILE" --path "$RUNNER_TEMP/t3code.ipa" --non-interactive',
    );
    // The iOS store job checks out a fresh tree, so the injection must run there, before submit.
    const iosJob = productionWorkflow.slice(productionWorkflow.indexOf("name: iOS store build"));
    expect(iosJob.indexOf("name: Configure fork App Store submission")).toBeGreaterThan(
      iosJob.indexOf("name: Checkout"),
    );
    expect(iosJob.indexOf("name: Configure fork App Store submission")).toBeLessThan(
      iosJob.indexOf("name: Submit to App Store Connect"),
    );
  });

  it("builds TestFlight prereleases with the production identity and fork App Store target", async () => {
    expect(easConfig.build.testflight).toMatchObject({ extends: "production" });
    // The submit profile inherits the injected production iOS target instead of overriding it.
    expect(easConfig.submit.testflight).toMatchObject({ extends: "production" });
    expect(easConfig.submit.testflight).not.toHaveProperty("ios");

    const config = await loadReleaseConfig({ variant: "production" });
    expect(config.ios?.bundleIdentifier).toBe("com.anoromi.t3code");
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
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "1");
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID", "invalid");

    await expect(loadConfig("development")).rejects.toThrow(
      "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS identifier",
    );
  });

  it("rejects an iOS relying party that is not a hostname", async () => {
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "0");
    vi.stubEnv("T3CODE_IOS_RELYING_PARTY", "https://clerk.example.com/path");

    await expect(loadConfig("production")).rejects.toThrow(
      "T3CODE_IOS_RELYING_PARTY must be a hostname",
    );
  });
});
