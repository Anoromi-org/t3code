# Checks the mutable-checkout launcher and its switch command from the Home
# Manager module: which checkout the launcher resolves, and what the switcher
# accepts and records. Evaluated against a stub of the few Home Manager options
# the module touches, so no Home Manager input is needed.
{ self, pkgs }:
let
  inherit (pkgs) lib;
  stubHomeManager = {
    options = {
      assertions = lib.mkOption { type = lib.types.listOf lib.types.unspecified; };
      home.homeDirectory = lib.mkOption { type = lib.types.str; };
      home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; };
    };
  };
  evaluated = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      stubHomeManager
      self.homeManagerModules.default
      {
        home.homeDirectory = "/home/test";
        programs.t3code = {
          enable = true;
          package = pkgs.emptyDirectory;
          local.enable = true;
        };
      }
    ];
  };
  config = evaluated.config;
  packageNamed =
    name:
    lib.findFirst (
      package: (package.name or "") == name
    ) (throw "home.packages has no ${name}") config.home.packages;
  launcher = packageNamed "t3code-local";
  switcher = packageNamed "t3code-switch";
in
assert lib.all (assertion: assertion.assertion) config.assertions;
assert
  config.programs.t3code.local.searchRoots == [
    "/home/test/code"
    "/home/test/.t3/worktrees"
  ];
pkgs.runCommand "t3code-home-manager-local-check"
  {
    nativeBuildInputs = [
      launcher
      switcher
    ];
  }
  ''
    export HOME="$TMPDIR/home"
    export XDG_CONFIG_HOME="$TMPDIR/config"
    repo_file="$XDG_CONFIG_HOME/t3code/local-repo"
    mkdir -p "$HOME"

    make_checkout() {
      mkdir -p "$1/scripts"
      touch "$1/flake.nix" "$1/scripts/run-local-desktop.sh"
    }
    expect_failure() {
      local expected="$1"
      shift
      if "$@" >"$TMPDIR/out" 2>&1; then
        echo "expected failure from: $*" >&2
        exit 1
      fi
      if ! grep -qF -- "$expected" "$TMPDIR/out"; then
        echo "expected '$expected' in output of: $*" >&2
        cat "$TMPDIR/out" >&2
        exit 1
      fi
    }

    make_checkout "$TMPDIR/a"
    make_checkout "$TMPDIR/b"
    mkdir -p "$TMPDIR/not-a-checkout"

    # Nothing configured on this machine yet.
    expect_failure "no T3 Code checkout configured" t3code-local

    # The switcher records a checkout and refuses anything else.
    t3code-switch "$TMPDIR/a" >/dev/null
    [ "$(cat "$repo_file")" = "$(realpath "$TMPDIR/a")" ]
    expect_failure "is not a T3 Code checkout" t3code-switch "$TMPDIR/not-a-checkout"
    [ "$(cat "$repo_file")" = "$(realpath "$TMPDIR/a")" ]
    t3code-switch "$TMPDIR/b" >/dev/null
    [ "$(cat "$repo_file")" = "$(realpath "$TMPDIR/b")" ]

    # The launcher reads the recorded checkout, and the environment wins over it.
    echo "$TMPDIR/not-a-checkout" > "$repo_file"
    expect_failure "expected a T3 Code flake at $TMPDIR/not-a-checkout" t3code-local
    expect_failure "Pick another with: t3code-switch" t3code-local
    T3CODE_LOCAL_REPO="$TMPDIR/elsewhere" \
      expect_failure "expected a T3 Code flake at $TMPDIR/elsewhere" t3code-local

    t3code-switch --help | grep -qF "Current: $TMPDIR/not-a-checkout"

    touch "$out"
  ''
