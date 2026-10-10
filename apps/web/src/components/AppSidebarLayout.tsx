import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";

import { isAnyCommandSurfaceOpen } from "../commandSurface";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { getLocalStorageItem, removeLocalStorageItem } from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import {
  recentThreadTargetKey,
  type RecentThreadTarget,
  useRecentThreadStore,
} from "../recentThreadStore";
import { cn, isMacPlatform } from "../lib/utils";
import { selectProjectGroupingSettings } from "../logicalProject";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  useClientSettings,
  useEnvironmentIdentificationMode,
  useLegacySidebarEnabled,
} from "../hooks/useSettings";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import { HyprnavLockFollower } from "./HyprnavLockFollower";
import LegacyThreadSidebar from "./LegacySidebar";
import { NavigationCommandMenu } from "./NavigationCommandMenu";
import { resolveDraftProjectKeys, resolveProjectDraftId } from "./NavigationCommandMenu.logic";
import { RecentThreadSwitcher } from "./RecentThreadSwitcher";
import { resolveRecentThreadSwitcherItems } from "./RecentThreadSwitcher.logic";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";
import {
  resolveSidebarStageFocusRingOffsetClass,
  useSidebarStageBackdropVariant,
} from "./SidebarStageBackdrop";
import { useProjects, useThreadShells } from "../state/entities";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isAnyCommandSurfaceOpen()) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B for bold; the toggle stays
        // available everywhere else, including the plain-text composer.
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    // Capture before focused editors consume commands such as Mod+B for rich-text formatting.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, toggleSidebar]);

  return (
    // The right-side layout controls carry mr-px (border compensation inside
    // the panel), so the trigger mirrors it: both clusters sit one extra pixel
    // off their edge and the titlebar reads symmetric.
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center"
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              // Over the stage artwork the trigger is a control on imagery, like the media
              // viewer's arrows; that variant positions itself, so the layout is reset here.
              variant={isSidebarVisible && stageBackdropVariant ? "media-navigation" : "ghost"}
              className={cn(
                "pointer-events-auto",
                isSidebarVisible && stageBackdropVariant && "relative top-auto translate-y-0",
                isSidebarVisible &&
                  stageBackdropVariant &&
                  resolveSidebarStageFocusRingOffsetClass(stageBackdropVariant),
              )}
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

type RouteThreadRef = ReturnType<typeof resolveThreadRouteRef>;

/** Shortcut context for layout-level handlers, read from stores at event time. */
function resolveLayoutShortcutContext(event: KeyboardEvent, routeThreadRef: RouteThreadRef) {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: routeThreadRef
      ? selectThreadTerminalUiState(
          useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
          routeThreadRef,
        ).terminalOpen
      : false,
    previewFocus: isPreviewFocused(),
    previewOpen: routeThreadRef
      ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
        "preview"
      : false,
    editableFocus: isEditableFocused(event.target),
    modelPickerOpen: isModelPickerOpen(),
  };
}

// Moves through the app's route history like a browser's back/forward buttons.
function NavigationHistoryShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isAnyCommandSurfaceOpen()) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: resolveLayoutShortcutContext(event, routeThreadRef),
      });
      if (command !== "navigation.back" && command !== "navigation.forward") return;

      event.preventDefault();
      event.stopPropagation();
      if (command === "navigation.back") window.history.back();
      else window.history.forward();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, routeThreadRef]);

  return null;
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

export function NavigationCommandMenuControl() {
  const [open, setOpen] = useState(false);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const projects = useProjects();
  const threads = useThreadShells();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const logicalProjectDraftThreadKeyByLogicalProjectKey = useComposerDraftStore(
    (state) => state.logicalProjectDraftThreadKeyByLogicalProjectKey,
  );
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (state) => state.getDraftSessionByLogicalProjectKey,
  );
  const activeDraftLogicalProjectKeys = useMemo(
    () =>
      new Set(
        Object.keys(logicalProjectDraftThreadKeyByLogicalProjectKey).filter(
          (logicalProjectKey) => getDraftSessionByLogicalProjectKey(logicalProjectKey) !== null,
        ),
      ),
    [getDraftSessionByLogicalProjectKey, logicalProjectDraftThreadKeyByLogicalProjectKey],
  );
  const draftProjectKeys = useMemo(
    () =>
      resolveDraftProjectKeys({
        projects,
        draftLogicalProjectKeys: activeDraftLogicalProjectKeys,
        projectGroupingSettings,
      }),
    [activeDraftLogicalProjectKeys, projectGroupingSettings, projects],
  );

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isAnyCommandSurfaceOpen("navigation")) return;
      if (
        resolveShortcutCommand(event, keybindings, {
          context: resolveLayoutShortcutContext(event, routeThreadRef),
        }) !== "navigation.commandMenu"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen((current) => !current);
    };
    // Capture so the shortcut still closes the menu while its input, which
    // stops keydown propagation, has focus.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, routeThreadRef]);

  const selectThread = useCallback(
    async (ref: ScopedThreadRef) => {
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
    },
    [navigate],
  );
  const selectProject = useCallback(
    async (ref: ScopedProjectRef) => {
      const draftId = resolveProjectDraftId({
        projectRef: ref,
        projects,
        projectGroupingSettings,
        getDraftIdByLogicalProjectKey: (logicalProjectKey) =>
          getDraftSessionByLogicalProjectKey(logicalProjectKey)?.draftId ?? null,
      });
      if (draftId) {
        const validatedDraftId = DraftId.make(draftId);
        await navigate({
          to: "/draft/$draftId",
          params: { draftId: validatedDraftId },
        });
        return;
      }
      await handleNewThread(ref);
    },
    [
      handleNewThread,
      getDraftSessionByLogicalProjectKey,
      navigate,
      projectGroupingSettings,
      projects,
    ],
  );

  return (
    <NavigationCommandMenu
      open={open}
      onOpenChange={setOpen}
      projects={projects}
      threads={threads}
      draftProjectKeys={draftProjectKeys}
      onSelectThread={selectThread}
      onSelectProject={selectProject}
    />
  );
}

export function RecentThreadSwitcherControl() {
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useThreadShells();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const cycle = useRecentThreadStore((state) => state.cycle);

  const eligibleThreadKeys = useMemo(
    () =>
      new Set(
        threads.flatMap((thread) =>
          thread.archivedAt === null
            ? [scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id })]
            : [],
        ),
      ),
    [threads],
  );

  const resolveTargets = useCallback(
    (targets: ReadonlyArray<RecentThreadTarget>) =>
      resolveRecentThreadSwitcherItems({
        targets,
        projects,
        threads,
        draftsById: draftThreadsByThreadKey,
      }),
    [draftThreadsByThreadKey, projects, threads],
  );
  const resolvedCycleItems = useMemo(
    () => resolveTargets(cycle?.targets ?? []),
    [cycle?.targets, resolveTargets],
  );

  useEffect(() => {
    if (!routeTarget) return;
    if (routeTarget.kind === "server") {
      if (!eligibleThreadKeys.has(scopedThreadKey(routeTarget.threadRef))) return;
      useRecentThreadStore.getState().recordVisit(routeTarget);
      return;
    }
    const draft = draftThreadsByThreadKey[routeTarget.draftId];
    if (!draft || draft.promotedTo) return;
    useRecentThreadStore.getState().recordVisit({
      kind: "draft",
      draftId: DraftId.make(routeTarget.draftId),
    });
  }, [draftThreadsByThreadKey, eligibleThreadKeys, routeTarget]);

  const navigateToTarget = useCallback(
    (target: RecentThreadTarget) => {
      if (target.kind === "server") {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(target.threadRef),
        });
        return;
      }
      void navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(target.draftId),
      });
    },
    [navigate],
  );

  // Drops targets that disappeared (archived, deleted, cleared drafts) and
  // swaps promoted drafts for their thread before the store is read.
  const reconcileTargets = useCallback(() => {
    const state = useRecentThreadStore.getState();
    const highlighted = state.cycle?.targets[state.cycle.highlightedIndex];
    state.reconcile(
      resolveTargets(state.history).map((item) => item.target),
      state.cycle ? resolveTargets(state.cycle.targets).map((item) => item.target) : undefined,
      highlighted ? resolveTargets([highlighted])[0]?.target : undefined,
    );
  }, [resolveTargets]);

  const commit = useCallback(
    (target?: RecentThreadTarget) => {
      const state = useRecentThreadStore.getState();
      const selectedTarget =
        target ?? (state.cycle ? state.cycle.targets[state.cycle.highlightedIndex] : undefined);
      const canonicalTarget = selectedTarget
        ? (resolveTargets([selectedTarget])[0]?.target ?? null)
        : null;
      reconcileTargets();
      if (!canonicalTarget) {
        useRecentThreadStore.getState().cancel();
        return;
      }
      const selected = useRecentThreadStore.getState().commit(canonicalTarget);
      if (selected) navigateToTarget(selected);
    },
    [navigateToTarget, reconcileTargets, resolveTargets],
  );

  useEffect(() => {
    const onThreadSwitcherAction = window.desktopBridge?.onThreadSwitcherAction;
    if (typeof onThreadSwitcherAction !== "function") return;

    return onThreadSwitcherAction((action) => {
      if (action === "advance-forward" || action === "advance-backward") {
        if (isAnyCommandSurfaceOpen("thread-switcher")) return;
        // Reconcile lazily at gesture start. Writing resolved targets back
        // during render can oscillate while a draft is promoted.
        reconcileTargets();
        useRecentThreadStore
          .getState()
          .advance(action === "advance-forward" ? "forward" : "backward");
        return;
      }
      if (action === "commit") {
        commit();
        return;
      }
      useRecentThreadStore.getState().cancel();
    });
  }, [commit, reconcileTargets]);

  // Match on the resolved target: a draft promoted mid-gesture is listed, and
  // committed, as its thread.
  const highlightedTarget = cycle?.targets[cycle.highlightedIndex] ?? null;
  const highlightedItemTarget = highlightedTarget
    ? (resolveTargets([highlightedTarget])[0]?.target ?? null)
    : null;
  const highlightedIndex = highlightedItemTarget
    ? resolvedCycleItems.findIndex(
        (item) =>
          recentThreadTargetKey(item.target) === recentThreadTargetKey(highlightedItemTarget),
      )
    : 0;

  return (
    <RecentThreadSwitcher
      open={cycle !== null && resolvedCycleItems.length >= 2}
      items={resolvedCycleItems}
      highlightedIndex={Math.max(0, highlightedIndex)}
      onCancel={() => useRecentThreadStore.getState().cancel()}
      onSelect={commit}
    />
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  // Settings routes show the settings nav in place of whichever thread
  // sidebar is active.
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // Subscribed rather than read once: the clamp must track live window size,
  // and a clamped drag ends with an unchanged width, which skips the re-render
  // that would otherwise refresh a render-time snapshot.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth);
  const resetSidebarWidth = () => {
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...(isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      <SidebarProvider
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        defaultOpen
        style={sidebarProviderStyle}
      >
        <ProjectProjectionRetention />
        <Sidebar
          side="left"
          collapsible="offcanvas"
          data-app-sidebar=""
          resizable={{
            maxWidth: sidebarMaximumWidth,
            minWidth: THREAD_SIDEBAR_MIN_WIDTH,
            shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
              nextWidth <= currentWidth ||
              wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
            onResize: setSidebarWidth,
          }}
        >
          {isOnSettings ? (
            <>
              <SidebarChromeHeader isElectron={isElectron} />
              <SettingsSidebarNav pathname={pathname} />
            </>
          ) : legacySidebarEnabled ? (
            <LegacyThreadSidebar />
          ) : (
            <ThreadSidebar />
          )}
          <SidebarRail onDoubleClick={resetSidebarWidth} />
        </Sidebar>
        {children}
        <SidebarControl />
        <NavigationHistoryShortcuts />
        <NavigationCommandMenuControl />
        {isElectron ? <RecentThreadSwitcherControl /> : null}
        <HyprnavLockFollower />
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
