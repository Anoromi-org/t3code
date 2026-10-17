import { createFileRoute } from "@tanstack/react-router";

import { HyprnavDefaultsSettingsPanel } from "../components/settings/ProjectHyprnavSettingsPanel";

export const Route = createFileRoute("/settings/hyprnav")({
  component: HyprnavDefaultsSettingsPanel,
});
