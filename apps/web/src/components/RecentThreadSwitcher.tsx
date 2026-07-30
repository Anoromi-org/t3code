import { MessageSquareTextIcon, SquarePenIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import type { RecentThreadTarget } from "../recentThreadStore";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { RecentThreadSwitcherItem } from "./RecentThreadSwitcher.logic";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "./ThreadStatusIndicators";
import {
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandPanel,
  CommandShortcut,
} from "./ui/command";
import { ScrollArea } from "./ui/scroll-area";

export function RecentThreadSwitcher(props: {
  readonly open: boolean;
  readonly items: ReadonlyArray<RecentThreadSwitcherItem>;
  readonly highlightedIndex: number;
  readonly onCancel: () => void;
  readonly onSelect: (target: RecentThreadTarget) => void;
}) {
  const listId = useId();
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());

  useLayoutEffect(() => {
    if (!props.open) return;
    optionRefs.current.get(props.highlightedIndex)?.scrollIntoView({ block: "nearest" });
  }, [props.highlightedIndex, props.open]);

  return (
    <CommandDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <CommandDialogPopup
        aria-label="Recent thread switcher"
        className="h-[min(32rem,72vh)] max-h-[min(32rem,72vh)] transition-[scale,opacity] duration-75 ease-out"
        data-command-surface="thread-switcher"
        data-recent-thread-switcher="true"
      >
        <div
          className="flex h-full min-h-0 flex-col"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== "Escape") return;
            event.preventDefault();
            props.onCancel();
          }}
        >
          <CommandPanel className="min-h-0 flex-1 rounded-t-[calc(var(--radius-2xl)-1px)]">
            <ScrollArea scrollbarGutter scrollFade>
              <div id={listId} className="h-full p-2" role="listbox">
                {props.items.map((item, index) => {
                  const highlighted = index === props.highlightedIndex;
                  return (
                    <button
                      key={
                        item.target.kind === "server"
                          ? `server:${item.target.threadRef.environmentId}:${item.target.threadRef.threadId}`
                          : `draft:${item.target.draftId}`
                      }
                      ref={(element) => {
                        if (element) optionRefs.current.set(index, element);
                        else optionRefs.current.delete(index);
                      }}
                      id={`${listId}-option-${index}`}
                      aria-selected={highlighted}
                      className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent/70 data-[highlighted=true]:bg-accent"
                      data-highlighted={highlighted}
                      onClick={() => props.onSelect(item.target)}
                      onMouseDown={(event) => event.preventDefault()}
                      role="option"
                      type="button"
                    >
                      {item.type === "thread" ? (
                        <MessageSquareTextIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <SquarePenIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                          {item.type === "thread" ? (
                            <ThreadRowLeadingStatus thread={item.thread} />
                          ) : null}
                          <span className="truncate">
                            {item.type === "thread" ? item.title : "New thread"}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.projectTitle}
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
                        <CommandShortcut className="tracking-normal">Draft</CommandShortcut>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CommandPanel>
          <CommandFooter>
            <span className="flex items-center gap-1.5">
              <CommandShortcut>Release Ctrl</CommandShortcut>Open
            </span>
            <span className="flex items-center gap-1.5">
              <CommandShortcut>Esc</CommandShortcut>Cancel
            </span>
          </CommandFooter>
        </div>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
