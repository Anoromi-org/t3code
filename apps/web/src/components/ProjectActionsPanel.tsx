import type {
  EditorId,
  EnvironmentId,
  ProjectScript,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  CloudUploadIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  InfoIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { shortcutLabelForCommand } from "../keybindings";
import { useSourceControlActionRunning } from "../lib/sourceControlActions";
import { shellEnvironment } from "../state/shell";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { ProjectScriptIconView } from "./ProjectScriptsControl";
import {
  buildProjectActionDescriptors,
  filterProjectActionGroups,
  type GitActionRequestKind,
  type ProjectActionDescriptor,
  type ProjectActionIcon,
} from "./ProjectActionsPanel.logic";
import { resolveOpenInOptions } from "./chat/OpenInPicker";
import { CommandDialog, CommandDialogPopup, CommandPanel, CommandShortcut } from "./ui/command";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

const RUNNING_SOURCE_CONTROL_ACTIONS = [
  "runStackedAction",
  "pull",
  "publishRepository",
  "init",
] as const;

function ProjectActionFallbackIcon(props: {
  readonly icon: ProjectActionIcon;
  readonly className: string;
}) {
  if (props.icon === "commit") return <GitCommitIcon className={props.className} />;
  if (props.icon === "push") return <UploadIcon className={props.className} />;
  if (props.icon === "pull-request") return <GitPullRequestIcon className={props.className} />;
  if (props.icon === "publish") return <CloudUploadIcon className={props.className} />;
  if (props.icon === "info") return <InfoIcon className={props.className} />;
  return <GitBranchIcon className={props.className} />;
}

function ActionIcon(props: {
  readonly descriptor: ProjectActionDescriptor;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly openInOptions: ReturnType<typeof resolveOpenInOptions>;
}) {
  const className = "size-4 shrink-0 text-muted-foreground";
  const intent = props.descriptor.intent;
  if (intent.kind === "run-script") {
    const script = props.scripts.find((entry) => entry.id === intent.scriptId);
    return script ? <ProjectScriptIconView icon={script.icon} className={className} /> : null;
  }
  if (intent.kind === "open-in") {
    const option = props.openInOptions.find((entry) => entry.value === intent.editor);
    return option ? <option.Icon className={className} /> : null;
  }
  return <ProjectActionFallbackIcon icon={props.descriptor.icon} className={className} />;
}

export function ProjectActionsPanel(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly gitCwd: string | null;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onRunProjectScript: (script: ProjectScript) => void | Promise<void>;
  readonly onRequestGitAction: (action: GitActionRequestKind) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listId = useId();
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const finalFocusRef = useRef<HTMLElement | null>(null);
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, "open project in editor");
  const gitStatus = useEnvironmentQuery(
    props.gitCwd
      ? vcsEnvironment.status({ environmentId: props.environmentId, input: { cwd: props.gitCwd } })
      : null,
  );
  const sourceControlScope = useMemo(
    () => ({ environmentId: props.environmentId, cwd: props.gitCwd }),
    [props.environmentId, props.gitCwd],
  );
  const gitActionRunning = useSourceControlActionRunning(
    sourceControlScope,
    RUNNING_SOURCE_CONTROL_ACTIONS,
  );
  const openInOptions = useMemo(
    () =>
      resolveOpenInOptions(
        typeof navigator === "undefined" ? "" : navigator.platform,
        props.availableEditors,
      ),
    [props.availableEditors],
  );
  const descriptors = useMemo(
    () =>
      buildProjectActionDescriptors({
        scripts: props.scripts,
        gitCwd: props.gitCwd,
        gitStatus: gitStatus.data,
        gitStatusPending: gitStatus.isPending,
        gitStatusError: gitStatus.error,
        gitActionRunning,
        openInTargets: openInOptions,
      }),
    [
      gitActionRunning,
      gitStatus.data,
      gitStatus.error,
      gitStatus.isPending,
      openInOptions,
      props.gitCwd,
      props.scripts,
    ],
  );
  const groups = useMemo(() => filterProjectActionGroups(descriptors, query), [descriptors, query]);
  const selectableItems = useMemo(
    () => groups.flatMap((group) => group.items.filter((item) => item.selectable)),
    [groups],
  );
  const activeOptionId = selectableItems[highlightedIndex]
    ? `${listId}-option-${highlightedIndex}`
    : undefined;

  useEffect(() => {
    if (props.open) {
      finalFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    setQuery("");
    setHighlightedIndex(0);
  }, [props.open]);
  useEffect(() => setHighlightedIndex(0), [query]);
  useEffect(() => {
    setHighlightedIndex((current) => Math.min(current, Math.max(0, selectableItems.length - 1)));
  }, [selectableItems.length]);
  useLayoutEffect(() => {
    if (props.open) optionRefs.current.get(highlightedIndex)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, props.open]);

  const execute = useCallback(
    (descriptor: ProjectActionDescriptor) => {
      if (!descriptor.selectable) return;
      finalFocusRef.current = null;
      props.onOpenChange(false);
      const intent = descriptor.intent;
      if (intent.kind === "run-script") {
        const script = props.scripts.find((entry) => entry.id === intent.scriptId);
        if (script) void props.onRunProjectScript(script);
        return;
      }
      if (intent.kind === "git") {
        props.onRequestGitAction(intent.action);
        return;
      }
      if (intent.kind === "open-in" && props.gitCwd) {
        void openInEditor({
          environmentId: props.environmentId,
          input: { cwd: props.gitCwd, editor: intent.editor },
        });
      }
    },
    [openInEditor, props],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((current) =>
          Math.min(current + 1, Math.max(0, selectableItems.length - 1)),
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setHighlightedIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setHighlightedIndex(Math.max(0, selectableItems.length - 1));
      } else if (event.key === "Enter") {
        const item = selectableItems[highlightedIndex];
        if (!item) return;
        event.preventDefault();
        execute(item);
      } else if (event.key === "Escape") {
        event.preventDefault();
        props.onOpenChange(false);
      }
    },
    [execute, highlightedIndex, props, selectableItems],
  );

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup
        aria-label="Project actions"
        className="h-auto max-h-[min(30rem,72vh)] transition-[scale,opacity] duration-75 ease-out motion-reduce:transition-none"
        data-command-surface="project-actions"
        data-project-actions-panel="true"
        finalFocus={() => finalFocusRef.current ?? false}
      >
        <div className="flex h-full min-h-0 flex-col">
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
                aria-label="Search project actions"
                autoFocus
                className="border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0 *:data-[slot=input]:ps-8"
                nativeInput
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search project actions"
                role="combobox"
                size="lg"
                type="search"
                unstyled
                value={query}
              />
            </div>
          </div>
          <CommandPanel className="min-h-0">
            <ScrollArea className="max-h-[min(24rem,calc(72vh-3rem))]" scrollbarGutter scrollFade>
              <div id={listId} className="h-full p-2" role="listbox">
                {groups.length === 0 ? (
                  <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                    No project actions match your search.
                  </div>
                ) : null}
                {groups.map((group) => (
                  <div className="py-1" key={group.id}>
                    <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const itemIndex = selectableItems.indexOf(item);
                        const highlighted = itemIndex >= 0 && itemIndex === highlightedIndex;
                        const shortcut = item.shortcutCommand
                          ? shortcutLabelForCommand(props.keybindings, item.shortcutCommand)
                          : null;
                        if (!item.selectable) {
                          return (
                            <div
                              className="flex min-h-10 items-center gap-3 px-2 py-1.5 text-left"
                              key={item.id}
                            >
                              <ActionIcon
                                descriptor={item}
                                openInOptions={openInOptions}
                                scripts={props.scripts}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-muted-foreground">
                                  {item.title}
                                </span>
                                {item.description ? (
                                  <span className="block truncate text-xs text-muted-foreground/70">
                                    {item.description}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <button
                            aria-selected={highlighted}
                            className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[highlighted=true]:bg-accent"
                            data-highlighted={highlighted}
                            id={`${listId}-option-${itemIndex}`}
                            key={item.id}
                            onClick={() => execute(item)}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseMove={() => setHighlightedIndex(itemIndex)}
                            ref={(element) => {
                              if (element) optionRefs.current.set(itemIndex, element);
                              else optionRefs.current.delete(itemIndex);
                            }}
                            role="option"
                            type="button"
                          >
                            <ActionIcon
                              descriptor={item}
                              openInOptions={openInOptions}
                              scripts={props.scripts}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {item.title}
                              </span>
                              {item.description ? (
                                <span className="block truncate font-mono text-xs text-muted-foreground">
                                  {item.description}
                                </span>
                              ) : null}
                            </span>
                            {shortcut ? <CommandShortcut>{shortcut}</CommandShortcut> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CommandPanel>
        </div>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
