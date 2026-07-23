import * as NodeOS from "node:os";

const VALID_DESKTOP_OZONE_PLATFORMS = new Set(["auto", "wayland", "x11"]);
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone launcher helper has no Effect runtime.
const hostPlatform = NodeOS.platform();

function configuredOzonePlatform(env) {
  const explicit = env.T3CODE_DESKTOP_OZONE_PLATFORM?.trim().toLowerCase();
  if (explicit) return explicit;

  const electronHint = env.ELECTRON_OZONE_PLATFORM_HINT?.trim().toLowerCase();
  if (electronHint) return electronHint;

  return env.NIXOS_OZONE_WL === "1" && env.WAYLAND_DISPLAY ? "wayland" : "";
}

export function resolveDesktopOzoneArgs(env = process.env, platform = hostPlatform) {
  if (platform !== "linux") return [];

  const ozonePlatform = configuredOzonePlatform(env);
  if (!VALID_DESKTOP_OZONE_PLATFORMS.has(ozonePlatform)) return [];

  return [
    "--enable-features=UseOzonePlatform",
    `--ozone-platform-hint=${ozonePlatform}`,
    ...(ozonePlatform === "auto" ? [] : [`--ozone-platform=${ozonePlatform}`]),
  ];
}

export function resolveDesktopOzoneEnv(env = process.env, platform = hostPlatform) {
  if (platform !== "linux") return {};

  const ozonePlatform = configuredOzonePlatform(env);
  if (!VALID_DESKTOP_OZONE_PLATFORMS.has(ozonePlatform)) return {};

  return {
    ELECTRON_OZONE_PLATFORM_HINT: ozonePlatform,
    ...(ozonePlatform === "wayland" ? { NIXOS_OZONE_WL: "1" } : {}),
  };
}
