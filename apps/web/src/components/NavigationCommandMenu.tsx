import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { FolderIcon, MessageSquareTextIcon, SearchIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { formatRelativeTimeLabel } from "../timestampFormat";
import { buildNavigationCommandResults } from "./NavigationCommandMenu.logic";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "./ThreadStatusIndicators";
import {
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandPanel,
  CommandShortcut,
} from "./ui/command";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

export function NavigationCommandMenu(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: readonly EnvironmentProject[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly draftProjectKeys?: ReadonlySet<string>;
  readonly onSelectThread: (ref: ScopedThreadRef) => void | Promise<void>;
  readonly onSelectProject: (ref: ScopedProjectRef) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listId = useId();
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const results = useMemo(
    () =>
      buildNavigationCommandResults({
        query,
        projects: props.projects,
        threads: props.threads,
        ...(props.draftProjectKeys ? { draftProjectKeys: props.draftProjectKeys } : {}),
      }),
    [props.draftProjectKeys, props.projects, props.threads, query],
  );
  const isSearching = query.trim().length > 0;
  const activeOptionId = results.length > 0 ? `${listId}-option-${highlightedIndex}` : undefined;

  useEffect(() => {
    if (props.open) return;
    setQuery("");
    setHighlightedIndex(0);
  }, [props.open]);

  useEffect(() => setHighlightedIndex(0), [query]);
  useEffect(() => {
    setHighlightedIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);
  useLayoutEffect(() => {
    if (props.open) optionRefs.current.get(highlightedIndex)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, props.open]);

  const selectItem = useCallback(
    (item: (typeof results)[number]) => {
      props.onOpenChange(false);
      if (item.type === "thread") void props.onSelectThread(item.ref);
      else void props.onSelectProject(item.ref);
    },
    [props],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((current) => Math.min(current + 1, Math.max(0, results.length - 1)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setHighlightedIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setHighlightedIndex(Math.max(0, results.length - 1));
      } else if (event.key === "Enter") {
        const item = results[highlightedIndex];
        if (!item) return;
        event.preventDefault();
        selectItem(item);
      } else if (event.key === "Escape") {
        event.preventDefault();
        props.onOpenChange(false);
      }
    },
    [highlightedIndex, props, results, selectItem],
  );

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup
        aria-label="Navigation command menu"
        className="h-[min(32rem,72vh)] max-h-[min(32rem,72vh)] transition-[scale,opacity] duration-75 ease-out"
        data-navigation-command-menu="true"
        data-command-surface="navigation"
      >
        <div
          className="flex h-full min-h-0 flex-col"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="px-2.5 py-1.5">
            <div className="relative text-foreground">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded={props.open}
                autoFocus
                className="border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0 *:data-[slot=input]:ps-8"
                nativeInput
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search threads and projects"
                role="combobox"
                size="lg"
                type="search"
                unstyled
                value={query}
              />
            </div>
          </div>
          <CommandPanel className="min-h-0 flex-1">
            <ScrollArea scrollbarGutter scrollFade>
              <div id={listId} className="h-full p-2" role="listbox">
                {results.length === 0 ? (
                  <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                    {isSearching ? "No matching threads or projects." : "No recent threads."}
                  </div>
                ) : null}
                {results.map((item, index) => {
                  const highlighted = index === highlightedIndex;
                  return (
                    <button
                      key={`${item.type}:${item.ref.environmentId}:${item.type === "thread" ? item.ref.threadId : item.ref.projectId}`}
                      ref={(element) => {
                        if (element) optionRefs.current.set(index, element);
                        else optionRefs.current.delete(index);
                      }}
                      id={`${listId}-option-${index}`}
                      aria-selected={highlighted}
                      className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent/70 data-[highlighted=true]:bg-accent"
                      data-highlighted={highlighted}
                      onClick={() => selectItem(item)}
                      onMouseDown={(event) => event.preventDefault()}
                      role="option"
                      type="button"
                    >
                      {item.type === "thread" ? (
                        <MessageSquareTextIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                          {item.type === "thread" ? (
                            <ThreadRowLeadingStatus thread={item.thread} />
                          ) : null}
                          <span className="truncate">{item.title}</span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.type === "thread" ? item.projectTitle : item.workspaceRoot}
                        </span>
                      </span>
                      {item.type === "thread" ? (
                        <span className="flex shrink-0 items-center gap-2">
                          <ThreadRowTrailingStatus thread={item.thread} />
                          <CommandShortcut className="tracking-normal">
                            {formatRelativeTimeLabel(item.recencyAt)}
                          </CommandShortcut>
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.hasDraft ? "Open draft" : "New thread"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CommandPanel>
          <CommandFooter>
            <span className="flex items-center gap-1.5">
              <CommandShortcut>Enter</CommandShortcut>Open
            </span>
            <span className="flex items-center gap-1.5">
              <CommandShortcut>Esc</CommandShortcut>Close
            </span>
          </CommandFooter>
        </div>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
