import type {
  AuthClientMetadataDeviceType,
  ResolvedKeybindingsConfig,
  ServerAuthSessionMethod,
} from "@t3tools/contracts";

const MOBILE_UNSUPPORTED_KEYBINDING_COMMANDS = new Set([
  "projectActions.toggle",
  "navigation.commandMenu",
  "chat.composer.focus",
  "thread.interrupt",
]);

export const projectKeybindingsForClient = (
  keybindings: ResolvedKeybindingsConfig,
  deviceType: AuthClientMetadataDeviceType,
  sessionMethod: ServerAuthSessionMethod,
): ResolvedKeybindingsConfig =>
  deviceType === "mobile" && sessionMethod !== "browser-session-cookie"
    ? keybindings.filter(
        (keybinding) => !MOBILE_UNSUPPORTED_KEYBINDING_COMMANDS.has(keybinding.command),
      )
    : keybindings;
