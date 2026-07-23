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
    text = ''
      repo_root=${lib.escapeShellArg cfg.local.repoPath}
      if [ ! -f "$repo_root/flake.nix" ]; then
        printf '%s: expected a T3 Code flake at %s\n' "$0" "$repo_root" >&2
        exit 1
      fi

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
  localDesktopItem = pkgs.makeDesktopItem {
    # Electron derives this filename from apps/desktop/package.json's productName
    # when the mutable checkout is launched as an application directory.
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
      type = lib.types.str;
      default = "";
      example = "/home/me/code/t3code";
      description = "Absolute path to the mutable T3 Code checkout.";
    };

    local.commandName = lib.mkOption {
      type = lib.types.str;
      default = "t3code-local";
      description = "Command name for the mutable-checkout launcher.";
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
        assertion = !cfg.local.enable || lib.hasPrefix "/" cfg.local.repoPath;
        message = "programs.t3code.local.repoPath must be an absolute path when enabled";
      }
    ];
    home.packages = [
      cfg.package
    ]
    ++ lib.optionals cfg.local.enable [
      localDesktopItem
      localLauncher
    ];
  };
}
