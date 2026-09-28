{
  autoPatchelfHook,
  cacert,
  copyDesktopItems,
  electron_44,
  fetchFromGitHub,
  fetchurl,
  fetchPnpmDeps,
  hyprlandSnapShot,
  kdeSnapShot,
  lib,
  libsecret,
  libxkbcommon,
  makeDesktopItem,
  nodejs_24,
  openssl,
  pkg-config,
  pnpm,
  pnpmConfigHook,
  python3,
  resourceMonitor,
  src,
  stdenv,
  t3codeElectron,
  xdg-utils,
}:

let
  serverPackage = builtins.fromJSON (builtins.readFile ../apps/server/package.json);
  vitePlusBindingInfo =
    {
      x86_64-linux = {
        package = "vite-plus-linux-x64-gnu";
        hash = "sha512-ZHN3RCA422XrGYmSDE9IZqx/eM5PsFCXHn8hUttQEwcSVXsuKBArDyb/uxonn1n0bPNW8c4G4HvNmIS3ckLXzA==";
      };
      aarch64-darwin = {
        package = "vite-plus-darwin-arm64";
        hash = "sha512-1hwUfQGqvzlO+qQ7r1i5XQWkKaWq/JcdAAZOPloMQsZq7P8rgiY1pq/0q4stzcNxFF74k4aEFOlDUKi6D149YA==";
      };
      aarch64-linux = {
        package = "vite-plus-linux-arm64-gnu";
        hash = "sha512-WC8/kT0/btxnwgYR5QvvelbgUaLQ6lbxs8aMQpjc63p1QdMTNZEbp3vnTV2l9KgoUYeyHnALJVBW9l1CJAM+fA==";
      };
    }
    .${stdenv.hostPlatform.system};
  vitePlusBinding = fetchurl {
    url = "https://registry.npmjs.org/@voidzero-dev/${vitePlusBindingInfo.package}/-/${vitePlusBindingInfo.package}-0.3.3.tgz";
    inherit (vitePlusBindingInfo) hash;
  };
  # The web build's license plugin reads SPDX texts from this cache before
  # downloading them, so seed it with the pinned revision for the sandbox.
  licenseScript = builtins.readFile ../scripts/lib/third-party-licenses.ts;
  spdxConstant =
    name: builtins.head (builtins.match ".*const ${name} = \"([^\"]+)\";.*" licenseScript);
  spdxLicenseListVersion = spdxConstant "SPDX_LICENSE_LIST_VERSION";
  spdxLicenseDetails = fetchFromGitHub {
    owner = "spdx";
    repo = "license-list-data";
    rev = spdxConstant "SPDX_LICENSE_LIST_REVISION";
    sparseCheckout = [ "json/details" ];
    hash = "sha256-DnrdJ13M8Vf8Dq8qKlO7Ad5jXa8L9YU9PBlpp7B9BoI=";
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "t3-code";
  version = serverPackage.version;
  inherit src;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-XCZIZD/U8CzzOptz2uk2R0s/qP6whLk8SELqgQAYg+w=";
  };

  nativeBuildInputs = [
    nodejs_24
    openssl
    pkg-config
    pnpm
    pnpmConfigHook
    python3
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
    copyDesktopItems
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    libsecret
    # @crowecawcaw/xa11y links libxkbcommon for accessibility key handling.
    libxkbcommon
    stdenv.cc.cc.lib
  ];

  env = {
    CI = "true";
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    npm_config_nodedir = electron_44.headers;
    OPENSSL_DIR = "${openssl.dev}";
    OPENSSL_INCLUDE_DIR = "${openssl.dev}/include";
    OPENSSL_LIB_DIR = "${openssl.out}/lib";
    PNPM_CONFIG_TRUST_LOCKFILE = "true";
    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";
  };

  desktopItems = lib.optionals stdenv.hostPlatform.isLinux [
    (makeDesktopItem {
      # Matches the app's default Linux desktop id so the portal, window
      # identity, and t3code:// handler all resolve to this entry.
      name = "com.t3tools.T3Code";
      desktopName = "T3 Code";
      exec = "t3-code %U";
      icon = "t3-code";
      startupWMClass = "t3code";
      mimeTypes = [ "x-scheme-handler/t3code" ];
      categories = [
        "Development"
        "Utility"
      ];
      terminal = false;
    })
  ];

  buildPhase = ''
    runHook preBuild

    # The pnpm FOD can omit an optional native package after a registry fetch error.
    mkdir -p node_modules/@voidzero-dev/${vitePlusBindingInfo.package}
    tar -xzf ${vitePlusBinding} \
      -C node_modules/@voidzero-dev/${vitePlusBindingInfo.package} \
      --strip-components=1

    spdx_cache=.generated/third-party-licenses/spdx/${spdxLicenseListVersion}
    mkdir -p "$spdx_cache"
    cp ${spdxLicenseDetails}/json/details/*.json "$spdx_cache/"

    pnpm exec vp run build:desktop

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app_root="$out/libexec/t3code"
    mkdir -p \
      "$app_root/apps/desktop" \
      "$app_root/apps/server" \
      "$out/bin"

    runtime_root="$TMPDIR/t3code-runtime"
    pnpm --filter @t3tools/desktop deploy \
      --prod \
      --ignore-scripts \
      --trust-lockfile \
      --config.inject-workspace-packages=true \
      "$runtime_root/desktop"
    pnpm --filter t3 deploy \
      --prod \
      --ignore-scripts \
      --trust-lockfile \
      --config.inject-workspace-packages=true \
      "$runtime_root/server"

    cp -a "$runtime_root/desktop/node_modules" "$app_root/node_modules"
    cp -a "$runtime_root/server/node_modules/." "$app_root/node_modules/"
    cp -a apps/desktop/dist-electron "$app_root/apps/desktop/dist-electron"
    cp -a apps/desktop/resources "$app_root/apps/desktop/resources"

    # Electron's own resources directory is immutable here, so the launcher
    # points T3CODE_DESKTOP_RESOURCES_PATH at the layout packaged builds expect.
    resources_root="$app_root/resources"
    mkdir -p "$resources_root"
    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      install -Dm755 native/browser-secret/build/*/t3-browser-secret \
        "$resources_root/browser-secret/t3-browser-secret"
      install -Dm755 ${lib.getExe hyprlandSnapShot} \
        "$resources_root/hyprland-capture/t3-hyprland-snap-shot"
      # The protocol XML carries the BSD notices required with the binary.
      cp -r native/hyprland-snap-shot/protocols "$resources_root/hyprland-capture/protocols"
      install -Dm755 ${lib.getExe kdeSnapShot} \
        "$resources_root/kde-capture/t3-kde-snap-shot"
      mkdir -p "$resources_root/gnome-extension"
      node -e 'for (const file of require("./apps/desktop/gnome-extension/bundle.json").files) console.log(file)' |
        while IFS= read -r file; do
          install -Dm644 "apps/desktop/gnome-extension/$file" "$resources_root/gnome-extension/$file"
        done
    ''}
    install -Dm755 ${lib.getExe resourceMonitor} \
      "$resources_root/resource-monitor/t3-resource-monitor"
    cp -a apps/server/dist "$app_root/apps/server/dist"

    cat > "$app_root/package.json" <<EOF
    {
      "name": "t3code",
      "version": "${finalAttrs.version}",
      "main": "apps/desktop/dist-electron/main.cjs"
    }
    EOF

    rm -rf "$app_root/node_modules/electron"
    rm -f "$app_root/node_modules/.bin/electron"
    rm -rf "$app_root/node_modules/@t3tools"
    rm -rf "$app_root/node_modules/.pnpm/"*file++++nix+var+nix+builds*
    rm -rf "$app_root/node_modules/.pnpm/"*musl*
    rm -f \
      "$app_root/node_modules/.modules.yaml" \
      "$app_root/node_modules/.package-map.json" \
      "$app_root/node_modules/.pnpm-workspace-state-v1.json" \
      "$app_root/node_modules/.pnpm/lock.yaml"
    find "$app_root/node_modules" -type f \( -name '*.musl.node' -o -name '*-musl.node' \) -delete
    find "$app_root/node_modules" -path '*/node-pty/prebuilds' -type d -prune -exec rm -rf {} +
    find "$app_root/node_modules" -xtype l -delete

    node_pty_dir="$(dirname "$(node -p "require.resolve('node-pty/package.json', { paths: ['$app_root'] })")")"
    (
      cd "$node_pty_dir"
      node ${pnpm}/lib/pnpm/dist/node_modules/node-gyp/bin/node-gyp.js rebuild
    )
    ${lib.optionalString stdenv.hostPlatform.isDarwin ''
      cp "$node_pty_dir/build/Release/spawn-helper" "$TMPDIR/spawn-helper"
    ''}
    cp "$node_pty_dir/build/Release/pty.node" "$TMPDIR/pty.node"
    rm -rf "$node_pty_dir/build"
    find "$node_pty_dir/../.." -maxdepth 1 -type d -name 'node-addon-api@*' -exec rm -rf {} +
    install -Dm755 "$TMPDIR/pty.node" "$node_pty_dir/build/Release/pty.node"

    ${lib.optionalString stdenv.hostPlatform.isDarwin ''
      install -Dm755 "$TMPDIR/spawn-helper" "$node_pty_dir/build/Release/spawn-helper"
    ''}

    install -Dm644 assets/prod/black-universal-1024.png \
      "$app_root/apps/desktop/resources/icon.png"
    install -Dm644 assets/prod/black-universal-1024.png \
      "$out/share/icons/hicolor/1024x1024/apps/t3-code.png"

    cat > "$out/bin/t3-code" <<EOF
    #!${stdenv.shell}
    unset ELECTRON_RUN_AS_NODE
    export T3CODE_DESKTOP_PACKAGE_CHANNEL=\''${T3CODE_DESKTOP_PACKAGE_CHANNEL:-nix}
    export T3CODE_DESKTOP_FORCE_PACKAGED=\''${T3CODE_DESKTOP_FORCE_PACKAGED:-1}
    export T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME=\''${T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME:-com.t3tools.T3Code.desktop}
    export T3CODE_DESKTOP_LINUX_URL_HANDLER_EXEC="$out/bin/t3-code"
    export T3CODE_DESKTOP_RESOURCES_PATH="$app_root/resources"
    export T3CODE_DISABLE_AUTO_UPDATE=\''${T3CODE_DISABLE_AUTO_UPDATE:-1}
    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      export PATH=${lib.makeBinPath [ xdg-utils ]}:\''${PATH:-}
    ''}

    sandbox_args=()
    if [[ \''${T3CODE_DESKTOP_DISABLE_SANDBOX:-0} == 1 ]]; then
      # Explicit escape hatch for hosts that disable unprivileged user
      # namespaces and cannot install a setuid Chromium sandbox helper.
      sandbox_args+=(--no-sandbox)
    fi

    ozone_args=()
    case "\''${T3CODE_DESKTOP_OZONE_PLATFORM:-}" in
      wayland)
        ozone_args+=(--enable-features=UseOzonePlatform --ozone-platform-hint=wayland --ozone-platform=wayland)
        ;;
      x11)
        ozone_args+=(--ozone-platform=x11)
        ;;
      auto)
        ozone_args+=(--ozone-platform-hint=auto)
        ;;
      "")
        if [[ -n \''${NIXOS_OZONE_WL:-} && -n \''${WAYLAND_DISPLAY:-} ]]; then
          ozone_args+=(--ozone-platform-hint=auto)
        fi
        ;;
    esac

    exec ${lib.getExe t3codeElectron} "$app_root" "\''${sandbox_args[@]}" "\''${ozone_args[@]}" "\$@"
    EOF
    chmod +x "$out/bin/t3-code"

    runHook postInstall
  '';

  meta = {
    description = "Minimal desktop GUI for coding agents";
    homepage = "https://github.com/pingdotgg/t3code";
    license = lib.licenses.mit;
    mainProgram = "t3-code";
    platforms = lib.platforms.linux ++ [ "aarch64-darwin" ];
  };
})
