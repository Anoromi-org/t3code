import { createFileRoute } from "@tanstack/react-router";

import { HyprnavDefaultsSettingsPanel } from "../components/settings/ProjectHyprnavSettingsPanel";

export const Route = createFileRoute("/_chat/settings/hyprnav")({
  component: HyprnavDefaultsSettingsPanel,
});
