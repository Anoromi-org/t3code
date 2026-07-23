{
  description = "T3 Code desktop app and development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      mkPkgs = system: import nixpkgs { inherit system; };
      mkPnpm = pkgs: pkgs.callPackage ./nix/pnpm.nix { };
      mkElectron = pkgs: pkgs.callPackage ./nix/electron.nix { };
      mkSource =
        pkgs:
        import ./nix/source.nix {
          lib = pkgs.lib;
          src = ./.;
        };
      mkDesktop =
        system:
        let
          pkgs = mkPkgs system;
          pnpm = mkPnpm pkgs;
          t3codeElectron = mkElectron pkgs;
        in
        pkgs.callPackage ./nix/desktop.nix {
          inherit pnpm t3codeElectron;
          src = mkSource pkgs;
        };
    in
    {
      packages = forAllSystems (system: rec {
        desktop = mkDesktop system;
        default = desktop;
        pnpm = mkPnpm (mkPkgs system);
        pnpm-deps = desktop.pnpmDeps;
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
          pnpm = mkPnpm pkgs;
          t3codeElectron = mkElectron pkgs;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.git
              t3codeElectron
              pkgs.nodejs_24
              pkgs.openssl
              pkgs.pkg-config
              pnpm
              pkgs.python3
              pkgs.xdg-utils
            ];
            env = {
              ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              T3CODE_DESKTOP_ELECTRON_PATH = pkgs.lib.getExe t3codeElectron;
              npm_config_nodedir = pkgs.electron_41.headers;
              OPENSSL_DIR = "${pkgs.openssl.dev}";
              OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";
              OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
              SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
            };
          };
        }
      );

      checks = forAllSystems (system: {
        desktop = self.packages.${system}.desktop;
      });

      formatter = forAllSystems (system: (mkPkgs system).nixfmt);
      homeManagerModules.default = import ./nix/home-manager.nix { inherit self; };
    };
}
