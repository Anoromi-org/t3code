# Web add fast mode and chat shortcuts

Expose provider-backed fast-mode controls and chat-scoped Mod+Shift+S focus and Mod+Shift+C interrupt shortcuts without interfering with upstream's Mod+S composer stash, terminals, model selection, or command surfaces. Preserve live navigation status indicators while toggling upstream's live `serviceTier` descriptor and retaining legacy boolean fast-mode compatibility.

Older native mobile sessions receive a filtered keybinding catalog based on upstream authentication device metadata, while desktop, browser, and unknown clients retain the complete catalog. Filtering applies consistently to initial configuration, mutations, snapshots, and live updates without changing stored server settings.

## Reimplementation Sources

This intent reimplements source commit `4ad89548eb` against upstream's model-option descriptors, composer draft persistence, interrupt command, navigation menu, and thread status components. It adds no duplicate fast-mode protocol, does not restore `/r`, and keeps legacy `/plan` and `/default` execution behind upstream's plan-mode setting while `/fast` remains provider-backed.

## Validation Coverage

Unit tests cover keybinding schemas and effective non-conflicting defaults, existing stash and customized shortcut preservation, running-session action resolution, per-thread interrupt exclusion, standalone `/fast` parsing and all attached-context guards (including expired terminal pills), live service-tier and legacy boolean descriptor validation, and unrelated option preservation. Chromium coverage verifies focus and single interrupt dispatch, repeat consumption, idle, terminal, command-surface, prevented-event, model-picker, and live preview-context guards; provider-supported and unsupported `/fast`; attached-context submission; sticky service-tier toggling; and navigation working, approval, input, connection, terminal, and remote status indicators.
