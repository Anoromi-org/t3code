import type { ProjectHyprnavSettings } from "@t3tools/contracts";

export function listProjectHyprnavSlots(settings: ProjectHyprnavSettings): ReadonlyArray<number> {
  return settings.bindings.map((binding) => binding.slot);
}

export function findProjectHyprnavDuplicateSlots(
  settings: ProjectHyprnavSettings,
): ReadonlyArray<number> {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const binding of settings.bindings) {
    const key = `${binding.scope}:${String(binding.slot)}`;
    if (seen.has(key)) duplicates.add(binding.slot);
    seen.add(key);
  }
  return [...duplicates].toSorted((left, right) => left - right);
}

export function projectHyprnavSettingsHasDuplicateSlots(settings: ProjectHyprnavSettings): boolean {
  return findProjectHyprnavDuplicateSlots(settings).length > 0;
}
