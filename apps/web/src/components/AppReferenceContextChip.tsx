import type { AppReferenceContextRecord } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { Link2Icon } from "lucide-react";

import { ContextChip, ContextChipLabel } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Where the user was in another app, attached by that app's prompt link. */
export function AppReferenceContextChip(props: {
  record: Pick<AppReferenceContextRecord, "label" | "app" | "details">;
  copyMarkdown?: string;
}) {
  const gt = useGT();
  const { label, app, details } = props.record;
  const from = app ? gt("From {app}", { app }) : gt("From another app");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="app-reference"
            tabIndex={0}
            aria-label={gt("App reference, {label}", { label })}
            data-markdown-copy={props.copyMarkdown}
          >
            <Link2Icon />
            <ContextChipLabel>{label}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        {[from, ...details.map((detail) => `${detail.name}: ${detail.value}`)].join(" · ")}
      </TooltipPopup>
    </Tooltip>
  );
}
