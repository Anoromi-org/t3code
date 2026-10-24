import { useEffect, useEffectEvent } from "react";

// A link's notice can be dismissed before the thread's composer mounts (cold start), so a
// request waits here until the composer for that draft takes it.
const pendingDraftKeys = new Set<string>();
const listeners = new Set<() => void>();

export function requestLinkedComposerFocus(draftKey: string): void {
  pendingDraftKeys.add(draftKey);
  for (const listener of listeners) listener();
}

export function takeLinkedComposerFocus(draftKey: string): boolean {
  return pendingDraftKeys.delete(draftKey);
}

export function subscribeLinkedComposerFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLinkedComposerFocus(draftKey: string, focus: () => void): void {
  const onFocusRequest = useEffectEvent(focus);
  useEffect(() => {
    let frame: number | null = null;
    const take = () => {
      if (!takeLinkedComposerFocus(draftKey)) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        onFocusRequest();
      });
    };
    take();
    const unsubscribe = subscribeLinkedComposerFocus(take);
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [draftKey]);
}
