#!/usr/bin/env bash

set -euo pipefail

if (($# < 1)); then
  printf 'usage: %s REPO_ROOT [ELECTRON_ARGS...]\n' "$0" >&2
  exit 2
fi

repo_root=$1
shift

if [[ $repo_root != /* ]] || [[ ! -f $repo_root/package.json ]]; then
  printf '%s: expected an absolute T3 Code checkout path, got %s\n' "$0" "$repo_root" >&2
  exit 2
fi

cd "$repo_root"

if [[ -z ${TERM:-} || ${TERM:-} == dumb ]]; then
  export TERM=xterm-256color
fi
unset IN_NIX_SHELL PS1 PS2 PS3 PS4 PROMPT PROMPT_COMMAND RPROMPT RPS1 SPROMPT

if [[ -z ${T3CODE_DESKTOP_OZONE_PLATFORM:-} && -n ${WAYLAND_DISPLAY:-} ]]; then
  export T3CODE_DESKTOP_OZONE_PLATFORM=wayland
fi
export T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME="${T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME:-t3-code-alpha.desktop}"

CI=true pnpm install --frozen-lockfile

node_pty_dir=$(dirname "$(node -p "require.resolve('node-pty/package.json', { paths: ['apps/server'] })")")
pnpm_exe=$(readlink -f "$(command -v pnpm)")
pnpm_root=$(dirname "$(dirname "$pnpm_exe")")
node_gyp="$pnpm_root/lib/pnpm/dist/node_modules/node-gyp/bin/node-gyp.js"
rm -rf "$node_pty_dir/build"
(
  cd "$node_pty_dir"
  node "$node_gyp" rebuild
)

pnpm exec vp run build:desktop
exec node apps/desktop/scripts/start-electron.mjs "$@"
