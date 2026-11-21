import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";

import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";

export function useShowHiddenProjects() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const showHiddenProjects =
    AsyncResult.isSuccess(preferencesResult) && preferencesResult.value.showHiddenProjects === true;
  const setShowHiddenProjects = useCallback(
    (show: boolean) => void savePreferences({ showHiddenProjects: show }),
    [savePreferences],
  );
  return { showHiddenProjects, setShowHiddenProjects } as const;
}
