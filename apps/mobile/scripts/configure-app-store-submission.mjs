import * as NodeFS from "node:fs";

export const UPSTREAM_APP_STORE_CONNECT_ID = "6787819824";

export function validateForkAppStoreConnectId(value) {
  const appStoreConnectId = value?.trim();
  if (!appStoreConnectId || !/^\d+$/.test(appStoreConnectId)) {
    throw new Error(
      "MOBILE_IOS_ASC_APP_ID must contain the fork App Store Connect numeric Apple ID.",
    );
  }
  if (appStoreConnectId === UPSTREAM_APP_STORE_CONNECT_ID) {
    throw new Error("MOBILE_IOS_ASC_APP_ID must not target the upstream T3 Code App Store record.");
  }
  return appStoreConnectId;
}

export function configureForkAppStoreSubmission(value, path = "eas.json") {
  const appStoreConnectId = validateForkAppStoreConnectId(value);
  const config = JSON.parse(NodeFS.readFileSync(path, "utf8"));
  config.submit.production.ios.ascAppId = appStoreConnectId;
  NodeFS.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  configureForkAppStoreSubmission(process.argv[2]);
}
