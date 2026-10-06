import type {
  DesktopHyprnavBrowserTabRegistration,
  HyprnavBrowserKind,
  HyprnavBrowserSlot,
} from "@t3tools/contracts";
import { AlertTriangleIcon, MinusIcon, PlusIcon, SaveIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "../../env";
import {
  useClientSettings,
  useClientSettingsHydrated,
  usePersistClientSettings,
} from "../../hooks/useSettings";
import {
  buildHyprnavBrowserTabThreads,
  hyprnavBrowserTabHistory,
  hyprnavBrowserTabHistoryKey,
  markHyprnavBrowserTabAttempt,
  persistHyprnavBrowserTabHistory,
  recordHyprnavBrowserTabs,
} from "../../hyprnavBrowserSlots";
import { useProjects, useThreadShells } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsSection } from "./settingsLayout";

export interface HyprnavBrowserSlotDraft {
  readonly key: string;
  readonly slot: string;
  readonly workspace: string;
  readonly browser: HyprnavBrowserKind;
  readonly tabName: string;
  readonly url: string;
  readonly param: string;
}

const BROWSER_LABELS: Record<HyprnavBrowserKind, string> = {
  chromium: "Chromium",
  firefox: "Firefox",
};

function draftKey(): string {
  return `browser-slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function browserSlotDraftFromSettings(
  slots: readonly HyprnavBrowserSlot[],
): HyprnavBrowserSlotDraft[] {
  return slots.map((slot) => ({
    key: draftKey(),
    slot: String(slot.slot),
    workspace: String(slot.workspace),
    browser: slot.browser,
    tabName: slot.tabName,
    url: slot.url,
    param: slot.param,
  }));
}

export function parseHyprnavBrowserSlotsDraft(draft: readonly HyprnavBrowserSlotDraft[]): {
  readonly slots: HyprnavBrowserSlot[] | null;
  readonly message: string | null;
} {
  const slots: HyprnavBrowserSlot[] = [];
  for (const item of draft) {
    const slot = Number(item.slot);
    const workspace = Number(item.workspace);
    if (!Number.isSafeInteger(slot) || slot < 1) {
      return { slots: null, message: "Every slot must be a positive whole number." };
    }
    if (!Number.isSafeInteger(workspace) || workspace < 1) {
      return { slots: null, message: "Every workspace must be a positive whole number." };
    }
    if (slots.some((existing) => existing.slot === slot)) {
      return { slots: null, message: "Each browser slot needs its own slot number." };
    }
    const tabName = item.tabName.trim();
    const url = item.url.trim();
    const param = item.param.trim();
    if (!tabName || !url || !param) {
      return { slots: null, message: "Browser slots need a tab name, URL and parameter." };
    }
    slots.push({ slot, workspace, browser: item.browser, tabName, url, param, value: "branch" });
  }
  return { slots, message: null };
}

function registrationOf(slot: HyprnavBrowserSlot): DesktopHyprnavBrowserTabRegistration {
  return { browser: slot.browser, tabName: slot.tabName, url: slot.url, param: slot.param };
}

const registrationKey = (slot: HyprnavBrowserSlot) => JSON.stringify(registrationOf(slot));

async function registerTab(slot: HyprnavBrowserSlot): Promise<string | null> {
  const register = window.desktopBridge?.registerHyprnavBrowserTab;
  if (!register) return "The Hyprnav desktop runtime is unavailable.";
  try {
    const result = await register(registrationOf(slot));
    return result.status === "ok"
      ? null
      : (result.message ?? `Could not register the ${slot.tabName} tab.`);
  } catch (error) {
    return error instanceof Error ? error.message : `Could not register the ${slot.tabName} tab.`;
  }
}

/** Global browser slots: every local thread's environment gets a slot driving a named tab. */
export function HyprnavBrowserSlotsSettings() {
  const hydrated = useClientSettingsHydrated();
  const saved = useClientSettings((settings) => settings.hyprnavBrowserSlots);
  const defaults = useClientSettings((settings) => settings.defaultProjectHyprnavSettings);
  const persistClientSettings = usePersistClientSettings();
  const primaryEnvironment = usePrimaryEnvironment();
  const projects = useProjects();
  const threadShells = useThreadShells();
  const [draft, setDraft] = useState(() => browserSlotDraftFromSettings(saved));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ readonly text: string; readonly warning: boolean } | null>(
    null,
  );
  const parsed = useMemo(() => parseHyprnavBrowserSlotsDraft(draft), [draft]);
  const savedKey = JSON.stringify(saved);
  const baselineRef = useRef(savedKey);
  const runtimeAvailable =
    isElectron && typeof window.desktopBridge?.syncHyprnavBrowserTabs === "function";

  useEffect(() => {
    // Adopt settings that change elsewhere (hydration, another window) unless edited here.
    const draftKeyNow = JSON.stringify(parseHyprnavBrowserSlotsDraft(draft).slots);
    const dirty = draftKeyNow !== baselineRef.current;
    baselineRef.current = savedKey;
    if (!dirty) setDraft(browserSlotDraftFromSettings(saved));
    // savedKey fingerprints `saved`.
  }, [savedKey]);

  const patch = (index: number, value: Partial<HyprnavBrowserSlotDraft>) =>
    setDraft((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...value } : item)),
    );

  const applyToThreads = async (slots: readonly HyprnavBrowserSlot[]): Promise<string | null> => {
    const sync = window.desktopBridge?.syncHyprnavBrowserTabs;
    const localEnvironmentId = primaryEnvironment?.environmentId ?? null;
    if (!sync || localEnvironmentId === null) return null;
    const threads = buildHyprnavBrowserTabThreads({
      localEnvironmentId,
      slots,
      threads: threadShells,
      projects,
      defaults,
      history: hyprnavBrowserTabHistory,
    });
    if (threads.length === 0) return null;
    const keyOf = (thread: (typeof threads)[number]) => hyprnavBrowserTabHistoryKey(thread);
    for (const thread of threads) {
      markHyprnavBrowserTabAttempt(hyprnavBrowserTabHistory, keyOf(thread), thread.browserTabs);
    }
    persistHyprnavBrowserTabHistory(hyprnavBrowserTabHistory);
    try {
      const result = await sync({ threads });
      const applied = new Set(result.appliedThreadIds);
      for (const thread of threads) {
        if (applied.has(thread.threadId)) {
          recordHyprnavBrowserTabs(hyprnavBrowserTabHistory, keyOf(thread), thread.browserTabs);
        }
      }
      persistHyprnavBrowserTabHistory(hyprnavBrowserTabHistory);
      return result.status === "ok" ? null : (result.message ?? "Hyprnav sync failed.");
    } catch (error) {
      return error instanceof Error ? error.message : "Hyprnav sync failed.";
    }
  };

  const save = async () => {
    if (!parsed.slots) return;
    const slots = parsed.slots;
    setBusy(true);
    try {
      const previousRegistrations = new Set(saved.map(registrationKey));
      await persistClientSettings({ hyprnavBrowserSlots: slots });
      baselineRef.current = JSON.stringify(slots);
      if (!runtimeAvailable) {
        setStatus({ text: "Saved. Browser slots apply in the desktop app.", warning: false });
        return;
      }
      const failures: string[] = [];
      // `tab open` can open a tab, so only new or changed tabs register on save.
      const toRegister = [
        ...new Map(
          slots
            .filter((slot) => !previousRegistrations.has(registrationKey(slot)))
            .map((slot) => [registrationKey(slot), slot] as const),
        ).values(),
      ];
      for (const slot of toRegister) {
        const failure = await registerTab(slot);
        if (failure) failures.push(`Tab ${slot.tabName}: ${failure}`);
      }
      const syncFailure = await applyToThreads(slots);
      if (syncFailure) failures.push(syncFailure);
      setStatus(
        failures.length === 0
          ? { text: "Saved and applied to threads.", warning: false }
          : { text: `Saved, but not fully applied. ${failures.join(" ")}`, warning: true },
      );
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : "Could not save browser slots.",
        warning: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const register = async (slot: HyprnavBrowserSlot) => {
    setBusy(true);
    try {
      const failure = await registerTab(slot);
      setStatus(
        failure
          ? { text: `Tab ${slot.tabName}: ${failure}`, warning: true }
          : { text: `Registered the ${slot.tabName} tab.`, warning: false },
      );
    } finally {
      setBusy(false);
    }
  };

  const disabled = !hydrated || busy;
  const savedSlots = new Map(saved.map((slot) => [slot.slot, slot] as const));

  return (
    <SettingsSection title="Browser slots">
      <div className="border-b border-border/60 px-4 py-3.5 sm:px-5">
        <p className="max-w-[70ch] text-xs text-muted-foreground/80">
          Every local thread with a branch gets this slot. Going to it switches to the workspace and
          points the named browser tab at the URL with the thread&apos;s branch as the parameter.
          Needs the hyprnav browser extension. A thread binding on the same slot takes precedence.
        </p>
      </div>
      {draft.length === 0 ? (
        <div className="px-5 py-6 text-center text-xs text-muted-foreground">No browser slots.</div>
      ) : (
        draft.map((item, index) => {
          const savedSlot = savedSlots.get(Number(item.slot));
          const label = item.tabName || `slot ${item.slot}`;
          return (
            <div
              key={item.key}
              className="border-t border-border/60 px-4 py-4 first:border-t-0 sm:px-5"
            >
              <div className="grid gap-3 lg:grid-cols-[5rem_6rem_9rem_minmax(0,1fr)_auto] lg:items-end">
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  Slot
                  <Input
                    aria-label={`Slot for browser ${label}`}
                    inputMode="numeric"
                    value={item.slot}
                    disabled={disabled}
                    onChange={(event) => patch(index, { slot: event.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  Workspace
                  <Input
                    aria-label={`Workspace for browser ${label}`}
                    inputMode="numeric"
                    value={item.workspace}
                    disabled={disabled}
                    onChange={(event) => patch(index, { workspace: event.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  Browser
                  <Select
                    value={item.browser}
                    disabled={disabled}
                    onValueChange={(value) =>
                      patch(index, { browser: value as HyprnavBrowserKind })
                    }
                  >
                    <SelectTrigger aria-label={`Browser for ${label}`}>
                      <SelectValue>{BROWSER_LABELS[item.browser]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {(Object.keys(BROWSER_LABELS) as HyprnavBrowserKind[]).map((browser) => (
                        <SelectItem key={browser} value={browser}>
                          {BROWSER_LABELS[browser]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  Tab name
                  <Input
                    aria-label={`Tab name for browser slot ${item.slot}`}
                    placeholder="pr-review"
                    value={item.tabName}
                    disabled={disabled}
                    onChange={(event) => patch(index, { tabName: event.target.value })}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove browser ${label}`}
                  disabled={disabled}
                  onClick={() =>
                    setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <MinusIcon className="size-4" />
                </Button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  URL
                  <Input
                    aria-label={`URL for browser ${label}`}
                    className="font-mono text-xs"
                    placeholder="http://127.0.0.1:4318/"
                    value={item.url}
                    disabled={disabled}
                    onChange={(event) => patch(index, { url: event.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  Branch parameter
                  <Input
                    aria-label={`Query parameter for browser ${label}`}
                    className="font-mono text-xs"
                    value={item.param}
                    disabled={disabled}
                    onChange={(event) => patch(index, { param: event.target.value })}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || !runtimeAvailable || !savedSlot}
                  title={savedSlot ? undefined : "Save first"}
                  onClick={() => savedSlot && void register(savedSlot)}
                >
                  Register tab
                </Button>
              </div>
            </div>
          );
        })
      )}
      <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            setDraft((current) => [
              ...current,
              {
                key: draftKey(),
                slot: "",
                workspace: "",
                browser: "chromium",
                tabName: "",
                url: "",
                param: "branch",
              },
            ])
          }
        >
          <PlusIcon className="size-3.5" />
          Add browser slot
        </Button>
        <div className="flex flex-1 items-center gap-2 text-xs">
          {parsed.message ? (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangleIcon className="size-3.5" />
              {parsed.message}
            </span>
          ) : status ? (
            <span
              className={
                status.warning
                  ? "inline-flex items-center gap-1.5 text-warning"
                  : "text-muted-foreground"
              }
            >
              {status.warning ? <AlertTriangleIcon className="size-3.5" /> : null}
              {status.text}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          aria-label="Save and apply browser slots"
          disabled={disabled || !parsed.slots}
          onClick={() => void save()}
        >
          <SaveIcon className="size-3.5" />
          Save and apply
        </Button>
      </div>
    </SettingsSection>
  );
}
