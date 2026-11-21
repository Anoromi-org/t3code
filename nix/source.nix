{ lib, src }:

lib.cleanSourceWith {
  inherit src;
  filter =
    path: type:
    let
      relativePath = lib.removePrefix "${toString src}/" (toString path);
      baseName = builtins.baseNameOf (toString path);
      ignoredDirectories = [
        ".git"
        ".codex"
        ".direnv"
        ".repos"
        ".t3"
        ".tanstack"
        ".vite-plus"
        "commits"
        "dist"
        "dist-electron"
        "node_modules"
        "nix"
        "playwright-report"
        "release"
        "result"
      ];
      ignoredSuffixes = [
        ".log"
        ".tsbuildinfo"
      ];
      ignoredFiles = [
        "AGENTS.md"
        "flake.lock"
        "flake.nix"
      ];
    in
    !(type == "directory" && lib.elem baseName ignoredDirectories)
    && !(lib.elem relativePath ignoredFiles)
    && !(lib.any (suffix: lib.hasSuffix suffix relativePath) ignoredSuffixes);
}
