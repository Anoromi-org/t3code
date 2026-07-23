{
  autoPatchelfHook,
  cacert,
  copyDesktopItems,
  electron_43,
  fetchPnpmDeps,
  lib,
  libsecret,
  makeDesktopItem,
  nodejs_24,
  openssl,
  pkg-config,
  pnpm,
  pnpmConfigHook,
  python3,
  src,
  stdenv,
  t3codeElectron,
  xdg-utils,
}:

let
  serverPackage = builtins.fromJSON (builtins.readFile ../apps/server/package.json);
in
stdenv.mkDerivation (finalAttrs: {
  pname = "t3-code";
  version = serverPackage.version;
  inherit src;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 3;
    hash = "sha256-BhX191Hp1hz4zMyH5myK6vbqNnHz7FpiKR7AihYLvMQ=";
  };

  nativeBuildInputs = [
    autoPatchelfHook
    copyDesktopItems
    nodejs_24
    openssl
    pkg-config
    pnpm
    pnpmConfigHook
    python3
  ];

  buildInputs = [ stdenv.cc.cc.lib libsecret ];

  env = {
    CI = "true";
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    npm_config_nodedir = electron_43.headers;
    OPENSSL_DIR = "${openssl.dev}";
    OPENSSL_INCLUDE_DIR = "${openssl.dev}/include";
    OPENSSL_LIB_DIR = "${openssl.out}/lib";
    PNPM_CONFIG_TRUST_LOCKFILE = "true";
    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";
  };

  desktopItems = [
    (makeDesktopItem {
      name = "t3code";
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
    install -Dm755 native/browser-secret/build/*/t3-browser-secret \
      "$app_root/apps/desktop/resources/browser-secret/t3-browser-secret"
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
    find "$app_root/node_modules" -type f -name '*.musl.node' -delete
    find "$app_root/node_modules" -path '*/node-pty/prebuilds' -type d -prune -exec rm -rf {} +
    find "$app_root/node_modules" -xtype l -delete

    node_pty_dir="$(dirname "$(node -p "require.resolve('node-pty/package.json', { paths: ['$app_root'] })")")"
    (
      cd "$node_pty_dir"
      node ${pnpm}/lib/pnpm/dist/node_modules/node-gyp/bin/node-gyp.js rebuild
    )
    cp "$node_pty_dir/build/Release/pty.node" "$TMPDIR/pty.node"
    rm -rf "$node_pty_dir/build"
    find "$node_pty_dir/../.." -maxdepth 1 -type d -name 'node-addon-api@*' -exec rm -rf {} +
    install -Dm755 "$TMPDIR/pty.node" "$node_pty_dir/build/Release/pty.node"

    install -Dm644 apps/desktop/resources/icon.png \
      "$out/share/icons/hicolor/1024x1024/apps/t3-code.png"

    cat > "$out/bin/t3-code" <<EOF
    #!${stdenv.shell}
    unset ELECTRON_RUN_AS_NODE
    export T3CODE_DESKTOP_PACKAGE_CHANNEL=\''${T3CODE_DESKTOP_PACKAGE_CHANNEL:-nix}
    export T3CODE_DESKTOP_FORCE_PACKAGED=\''${T3CODE_DESKTOP_FORCE_PACKAGED:-1}
    export T3CODE_DESKTOP_LINUX_URL_HANDLER_EXEC="$out/bin/t3-code"
    export T3CODE_DISABLE_AUTO_UPDATE=\''${T3CODE_DISABLE_AUTO_UPDATE:-1}
    export PATH=${lib.makeBinPath [ xdg-utils ]}:\''${PATH:-}

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
    platforms = lib.platforms.linux;
  };
})
