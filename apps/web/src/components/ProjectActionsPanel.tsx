import {
  buildRemoteOpenUrl,
  type EditorId,
  type EnvironmentId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  CloudUploadIcon,
  GitBranchIcon,
  GitCommitIcon,
  InfoIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";

import { shortcutLabelForCommand } from "../keybindings";
import { openRemoteEditorUrl, useRemoteCapableEditors, useRemoteOpenState } from "../remoteOpen";
import { useSourceControlActionRunning } from "../lib/sourceControlActions";
import { shellEnvironment } from "../state/shell";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { ScriptIcon } from "./projectScriptEditor";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
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
  if (props.icon === "pull-request")
    return <PullRequestGlyph.pullRequest className={props.className} />;
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
    return script ? <ScriptIcon icon={script.icon} className={className} /> : null;
  }
  if (intent.kind === "open-in") {
    const option = props.openInOptions.find((entry) => entry.value === intent.editor);
    return option ? <option.Icon className={className} /> : null;
  }
  return <ProjectActionFallbackIcon icon={props.descriptor.icon} className={className} />;
}

interface ProjectActionsPanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly gitCwd: string | null;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onRunProjectScript: (script: ProjectScript) => void | Promise<void>;
  readonly onRequestGitAction: (action: GitActionRequestKind) => void;
}

export function ProjectActionsPanel(props: ProjectActionsPanelProps) {
  // Focus returns to whatever had it when the panel opened. It is read while
  // rendering the opening, before the search field takes focus.
  const [finalFocus, setFinalFocus] = useState<HTMLElement | null>(null);
  const [renderedOpen, setRenderedOpen] = useState(props.open);
  if (renderedOpen !== props.open) {
    setRenderedOpen(props.open);
    if (props.open) {
      setFinalFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
  }
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup
        aria-label="Project actions"
        className="h-auto max-h-[min(30rem,72vh)]"
        data-command-surface="project-actions"
        data-project-actions-panel="true"
        finalFocus={() => finalFocus ?? false}
      >
        {/* Mounted only while open, so closing resets the search and highlight
            and status queries and rows only run while it is shown. */}
        {props.open ? (
          <ProjectActionsPanelBody {...props} onSkipFocusRestore={() => setFinalFocus(null)} />
        ) : null}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function ProjectActionsPanelBody(
  props: ProjectActionsPanelProps & { readonly onSkipFocusRestore: () => void },
) {
  const remote = useRemoteOpenState(props.environmentId);
  const remoteEditors = useRemoteCapableEditors();
  const effectiveEditors = remote.mode === "local-exec" ? props.availableEditors : remoteEditors;
  const [query, setQuery] = useState("");
  const [highlightedIndexState, setHighlightedIndex] = useState(0);
  const listId = useId();
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, "open project in editor");
  // Subscribed only while open; the header already keeps this status warm.
  const gitStatus = useEnvironmentQuery(
    props.gitCwd
      ? vcsEnvironment.status({ environmentId: props.environmentId, input: { cwd: props.gitCwd } })
      : null,
  );
  const sourceControlScope = { environmentId: props.environmentId, cwd: props.gitCwd };
  const gitActionRunning = useSourceControlActionRunning(
    sourceControlScope,
    RUNNING_SOURCE_CONTROL_ACTIONS,
  );
  const openInOptions =
    remote.mode === "remote-unavailable"
      ? []
      : resolveOpenInOptions(
          typeof navigator === "undefined" ? "" : navigator.platform,
          effectiveEditors,
        );
  const descriptors = buildProjectActionDescriptors({
    scripts: props.scripts,
    gitCwd: props.gitCwd,
    gitStatus: gitStatus.data,
    gitStatusPending: gitStatus.isPending,
    gitStatusError: gitStatus.error,
    gitActionRunning,
    openInTargets: openInOptions,
  });
  const groups = filterProjectActionGroups(descriptors, query);
  const selectableItems = groups.flatMap((group) => group.items.filter((item) => item.selectable));
  const highlightedIndex = Math.min(highlightedIndexState, Math.max(0, selectableItems.length - 1));
  const activeOptionId = selectableItems[highlightedIndex]
    ? `${listId}-option-${highlightedIndex}`
    : undefined;

  useLayoutEffect(() => {
    optionRefs.current.get(highlightedIndex)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const execute = (descriptor: ProjectActionDescriptor) => {
    if (!descriptor.selectable) return;
    // A chosen action owns focus next, so closing does not restore it.
    props.onSkipFocusRestore();
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
      if (remote.mode === "remote-unavailable") return;
      if (remote.mode === "remote-links") {
        const url = buildRemoteOpenUrl({
          editor: intent.editor,
          host: remote.host.host,
          absolutePath: props.gitCwd,
        });
        if (url) void openRemoteEditorUrl(url);
        return;
      }
      void openInEditor({
        environmentId: props.environmentId,
        input: { cwd: props.gitCwd, editor: intent.editor },
      });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME Enter confirms the composition; it must not run an action.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex(Math.min(highlightedIndex + 1, Math.max(0, selectableItems.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex(Math.max(0, highlightedIndex - 1));
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
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2.5 py-1.5">
        <div className="flex items-center gap-1 ps-3 text-foreground">
          <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <Input
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={props.open}
            aria-label="Search project actions"
            autoFocus
            className="min-w-0 flex-1"
            nativeInput
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
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
                        className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[highlighted=true]:bg-accent"
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
                          <span className="block truncate text-sm font-medium">{item.title}</span>
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
  );
}
