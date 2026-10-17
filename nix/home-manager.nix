{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.t3code;
  system = pkgs.stdenv.hostPlatform.system;
  localLauncher = pkgs.writeShellApplication {
    name = cfg.local.commandName;
    # Keep writeShellApplication from changing PATH before the user environment
    # is captured. The launcher adds its own tools immediately afterward.
    runtimeInputs = [ ];
    # The checkout location is per-machine state, so it is resolved at run time
    # rather than baked into a config that may be shared across machines.
    text = ''
      repo_file="''${XDG_CONFIG_HOME:-$HOME/.config}/t3code/local-repo"

      repo_root="''${T3CODE_LOCAL_REPO:-}"
      if [ -z "$repo_root" ] && [ -f "$repo_file" ]; then
        repo_root="$(head -n 1 "$repo_file")"
      fi
      if [ -z "$repo_root" ]; then
        repo_root=${lib.escapeShellArg (if cfg.local.repoPath == null then "" else cfg.local.repoPath)}
      fi

      if [ -z "$repo_root" ]; then
        printf '%s: no T3 Code checkout configured on this machine.\n' "$0" >&2
        printf 'Run: %s\n' ${lib.escapeShellArg cfg.local.switchCommandName} >&2
        exit 1
      fi
      if [ ! -f "$repo_root/flake.nix" ]; then
        printf '%s: expected a T3 Code flake at %s\n' "$0" "$repo_root" >&2
        printf 'Pick another with: %s\n' ${lib.escapeShellArg cfg.local.switchCommandName} >&2
        exit 1
      fi

      # shellcheck disable=SC1091
      source ${lib.escapeShellArg "${self.outPath}/nix/local-launch-environment.sh"}
      t3code_capture_local_launch_environment
      export PATH=${
        lib.makeBinPath [
          pkgs.bashInteractive
          pkgs.coreutils
          pkgs.nix
          pkgs.util-linux
        ]
      }:"$PATH"

      t3code_run_local_launch ${lib.getExe pkgs.nix} develop --impure ${lib.escapeShellArg "${self.outPath}#default"} \
        --command bash "$repo_root/scripts/run-local-desktop.sh" "$repo_root" "$@"
    '';
  };
  # Picks which checkout the local launcher runs. Candidates are the current
  # checkout's git worktrees plus any T3 Code checkout under the search roots.
  localSwitcher = pkgs.writeShellApplication {
    name = cfg.local.switchCommandName;
    runtimeInputs = [
      pkgs.coreutils
      pkgs.findutils
      pkgs.gawk
      pkgs.gnused
      pkgs.git
      pkgs.fzf
    ];
    text = ''
      repo_file="''${XDG_CONFIG_HOME:-$HOME/.config}/t3code/local-repo"
      current=""
      if [ -f "$repo_file" ]; then
        current="$(head -n 1 "$repo_file")"
      fi

      is_checkout() {
        [ -f "$1/flake.nix" ] && [ -f "$1/scripts/run-local-desktop.sh" ]
      }

      if [ "$#" -gt 0 ]; then
        case "$1" in
          -h|--help)
            printf 'usage: %s [PATH]\n' "$0"
            printf 'Without PATH, pick a checkout interactively. Current: %s\n' "''${current:-none}"
            exit 0
            ;;
        esac
        target="$1"
      else
        candidates() {
          if [ -n "$current" ] && [ -d "$current" ]; then
            git -C "$current" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p'
          fi
          for root in ${lib.escapeShellArgs cfg.local.searchRoots}; do
            [ -d "$root" ] || continue
            find "$root" -maxdepth 4 -path '*/scripts/run-local-desktop.sh' -type f 2>/dev/null \
              | sed 's|/scripts/run-local-desktop.sh$||'
          done
        }
        target="$(
          candidates | while IFS= read -r dir; do
            if is_checkout "$dir"; then realpath "$dir"; fi
          done | awk '!seen[$0]++' \
            | fzf --prompt='T3 Code checkout> ' --header="current: ''${current:-none}" --select-1 --exit-0
        )" || true
        if [ -z "$target" ]; then
          printf '%s: nothing selected; current: %s\n' "$0" "''${current:-none}" >&2
          exit 1
        fi
      fi

      if ! is_checkout "$target"; then
        printf '%s: %s is not a T3 Code checkout (needs flake.nix and scripts/run-local-desktop.sh)\n' "$0" "$target" >&2
        exit 1
      fi
      mkdir -p "$(dirname "$repo_file")"
      realpath "$target" > "$repo_file"
      printf '%s now runs %s\n' ${lib.escapeShellArg cfg.local.commandName} "$(cat "$repo_file")"
    '';
  };
  localDesktopItem = pkgs.makeDesktopItem {
    # scripts/run-local-desktop.sh passes this id through
    # T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME, so the app uses this entry for its
    # portal identity and t3code:// handler instead of writing its own.
    name = "t3-code-alpha";
    desktopName = cfg.local.desktopName;
    exec = "${cfg.local.commandName} %U";
    icon = "t3-code";
    startupWMClass = "t3code";
    mimeTypes = [ "x-scheme-handler/t3code" ];
    categories = [
      "Development"
      "Utility"
    ];
    terminal = false;
  };
in
{
  options.programs.t3code = {
    enable = lib.mkEnableOption "T3 Code desktop app";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${system}.desktop;
      description = "T3 Code desktop package to install.";
    };

    local.enable = lib.mkEnableOption "mutable-checkout T3 Code launcher";

    local.repoPath = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/home/me/code/t3code";
      description = ''
        Fallback path to the mutable T3 Code checkout. Prefer leaving this unset
        and running the switch command on each machine; the launcher checks
        $T3CODE_LOCAL_REPO, then $XDG_CONFIG_HOME/t3code/local-repo, then this
        option.
      '';
    };

    local.commandName = lib.mkOption {
      type = lib.types.str;
      default = "t3code-local";
      description = "Command name for the mutable-checkout launcher.";
    };

    local.switchCommandName = lib.mkOption {
      type = lib.types.str;
      default = "t3code-switch";
      description = "Command name for picking which checkout the launcher runs.";
    };

    local.searchRoots = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "${config.home.homeDirectory}/code"
        "${config.home.homeDirectory}/.t3/worktrees"
      ];
      defaultText = lib.literalExpression ''[ "''${config.home.homeDirectory}/code" "''${config.home.homeDirectory}/.t3/worktrees" ]'';
      description = "Directories the switch command searches for T3 Code checkouts.";
    };

    local.desktopName = lib.mkOption {
      type = lib.types.str;
      default = "T3 Code Local";
      description = "Desktop entry name for the mutable-checkout launcher.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.local.repoPath == null || lib.hasPrefix "/" cfg.local.repoPath;
        message = "programs.t3code.local.repoPath must be an absolute path when set";
      }
    ];
    home.packages = [
      cfg.package
    ]
    ++ lib.optionals cfg.local.enable [
      localDesktopItem
      localLauncher
      localSwitcher
    ];
  };
}
