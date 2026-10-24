# project hidden projects

## Goal

The Learning project gets many lesson threads that would flood every all-projects list. A
project can now be hidden: it and its threads leave the aggregate views on web, desktop and
mobile until the user shows hidden projects, while explicit intent (filtering to the project,
opening one of its threads by route or deep link, search) still shows it normally.

## Included Changes

- Contracts: `Project` and `OrchestrationProjectShell` carry `hidden: boolean` through
  `ProjectHidden`, which decodes a missing field as `false` (older servers and events).
  `ProjectCreatePayload` and `ProjectUpdatePayload` take optional `hidden`; `project.created` and
  `project.meta-updated` payloads carry it optionally.
- Server: `ProjectStoreV2` stores `projection_projects.hidden` (bit). A `project.created` without
  the field keeps the stored flag, as `hyprnav` does for baseline re-creation. `planProjectCommand`
  creates with `hidden ?? false` and copies an explicit update. `ProjectService` and the mutation
  operation forward it.
- Migration: fork migration 4 `ProjectionProjectsHidden` in `t3code_fork_migrations` adds
  `hidden INTEGER NOT NULL DEFAULT 0` when missing. No upstream slot is used.
- MCP: `t3_project_list`/`t3_project_read` return `hidden`, `t3_project_update` and
  `t3_project_create` accept it (schemas come from the contracts). A title-only create with
  `hidden: true` creates the managed project, then hides it with an update.
- `@t3tools/client-runtime/state/hidden-projects`: `hiddenProjectKeys`, `isInHiddenProject`,
  `excludeHiddenProjectItems` (with a keep predicate for the routed thread) and
  `preferVisibleProjects` for automatic project choices. `createProject`/`updateProject` pass
  `hidden`.
- Web: `uiStateStore.showHiddenProjects` (persisted with the UI state). The sidebar thread
  partition drops threads of hidden projects in the all-projects scope (not while searching)
  and keeps the routed thread. The project filter combobox lists hidden groups only when shown, searched, or selected;
  shown ones are dimmed. Each project row has an eye button to hide or unhide, and a
  **Show hidden projects** switch sits at the bottom once any project is hidden. Project
  settings → Project has a **Hidden** switch (mixed when only some checkouts are hidden). The
  legacy sidebar drops hidden groups and the thread refs of hidden checkouts in partly hidden
  groups (keeping the routed thread's project), adds Hide/Unhide
  project to the project context menu and the switch to Sidebar options. The `/` landing and the
  default new-thread project prefer visible projects. A group is hidden only when every checkout
  is; hiding applies to all checkouts.
- Mobile: `showHiddenProjects` in mobile preferences. The home list and tablet/Android sidebar
  drop hidden projects' threads and pending tasks unless shown, filtered to a project, or
  searching, and keep the open thread. **Show hidden projects** is in the Project submenu of every
  thread-list filter menu. Pickers list hidden projects last and mark them "Hidden"; shown rows
  read "Title · Hidden". Settings → project → Overview has **Hide project** / **Unhide project**.
- Docs: "Hide a project" in `docs/user/project-settings.md`.

## Not changed

Push notifications, the desktop notification badge (it counts notified threads), the Ctrl+Tab
recent-thread switcher (only threads the user visited), the command palette and thread search,
and the pull request and scheduled-task project pickers.

## Validation Coverage

- `packages/contracts/src/project.test.ts`: missing `hidden` decodes as false on shell and
  project; payloads keep it optional.
- `apps/server/src/orchestration-v2/ProjectStoreHidden.test.ts`: default, update, unrelated
  update, baseline re-creation, explicit create.
- `ProjectCommands.test.ts`, `ProjectMutation.test.ts`: create default, explicit flag, update.
- `ForkCompatibility.test.ts`: ledger rows include fork 4, schema has the column.
- `apps/server/src/mcp/toolkits/project/tools.test.ts` and `handlers.test.ts`: tool schemas
  expose `hidden`; title-only and workspace creates honor it.
- `packages/client-runtime/src/state/hiddenProjects.test.ts`, `apps/web` `Sidebar.logic.test.ts`
  (thread filter, group hidden, picker visibility, legacy group filter), `uiStateStore.test.ts`.
- `apps/mobile/src/features/home/hidden-projects.test.ts`, `home-list-filter-menu.test.ts`.
