{
  autoPatchelfHook,
  fetchurl,
  lib,
  nodejs_26,
  stdenv,
}:

let
  # pnpm 12 is a native binary. Its npm package only carries a placeholder that
  # downloads the binary on first use, which the build sandbox cannot do, so the
  # platform package is fetched directly.
  nativeBinaryInfo =
    {
      x86_64-linux = {
        package = "exe.linux-x64";
        hash = "sha512-F6K8e/jWxiuEYJaQtRRUG9ynBSTEHa+t7Lf86MKuOO5UA7WVVMbi+oB8nY6iKW++ncWS2yG6T9faXZGxqNsfoQ==";
      };
      aarch64-linux = {
        package = "exe.linux-arm64";
        hash = "sha512-7joGShZ44Nk3WpNU+60JoOPjCXlgxhJAq11S2UiVtwCUDgTer1yTPPfxGW8pxaD6046actYLIYDbZNlubHWs0A==";
      };
    }
    .${stdenv.hostPlatform.system};
in
stdenv.mkDerivation (finalAttrs: {
  pname = "pnpm";
  version = "12.14.0";

  # The wrapper package ships the dist/ payload (node-gyp) the binary looks for
  # next to itself.
  src = fetchurl {
    url = "https://registry.npmjs.org/pnpm/-/pnpm-${finalAttrs.version}.tgz";
    hash = "sha512-wYum2HmT09Fky16JSPMrLAbuhUSH4GzY2GeBNC+z5btGNDZwNHEehoArqpw3vqkGzhkprQjXCITJfYAd8TOJpg==";
  };

  nativeBinary = fetchurl {
    url = "https://registry.npmjs.org/@pnpm/${nativeBinaryInfo.package}/-/${nativeBinaryInfo.package}-${finalAttrs.version}.tgz";
    inherit (nativeBinaryInfo) hash;
  };

  sourceRoot = "package";
  nativeBuildInputs = [ autoPatchelfHook ];
  buildInputs = [ stdenv.cc.cc.lib ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/pnpm" "$out/bin" native
    cp -a dist package.json "$out/lib/pnpm/"
    tar -xzf "$nativeBinary" -C native --strip-components=1
    install -Dm755 native/pnpm "$out/lib/pnpm/pnpm"

    # Real scripts rather than symlinks: run-local-desktop.sh finds node-gyp
    # relative to the resolved pnpm path.
    cat > "$out/bin/pnpm" <<EOF
    #!${stdenv.shell}
    exec "$out/lib/pnpm/pnpm" "\$@"
    EOF
    cat > "$out/bin/pnpx" <<EOF
    #!${stdenv.shell}
    exec "$out/lib/pnpm/pnpm" dlx "\$@"
    EOF
    chmod +x "$out/bin/pnpm" "$out/bin/pnpx"
    ln -s pnpm "$out/bin/pn"
    ln -s pnpx "$out/bin/pnx"

    runHook postInstall
  '';

  meta = {
    description = "Fast, disk space efficient package manager";
    homepage = "https://pnpm.io";
    license = lib.licenses.mit;
    mainProgram = "pnpm";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };

  passthru.nodejs-slim = nodejs_26;
})
