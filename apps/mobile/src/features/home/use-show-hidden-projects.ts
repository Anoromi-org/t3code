import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

export function useShowHiddenProjects() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const showHiddenProjects =
    AsyncResult.isSuccess(preferencesResult) && preferencesResult.value.showHiddenProjects === true;
  const setShowHiddenProjects = useCallback(
    (show: boolean) => savePreferences({ showHiddenProjects: show }),
    [savePreferences],
  );
  return { showHiddenProjects, setShowHiddenProjects } as const;
}
