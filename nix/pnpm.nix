{
  fetchurl,
  lib,
  makeWrapper,
  nodejs_24,
  stdenvNoCC,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "pnpm";
  version = "11.10.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/pnpm/-/pnpm-${finalAttrs.version}.tgz";
    hash = "sha256-YgtmBepPYvxWptCphzP0eQcdAyHgPkhrUix+mnRhdDE=";
  };

  sourceRoot = "package";
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/pnpm" "$out/libexec" "$out/bin"
    cp -a . "$out/lib/pnpm"
    makeWrapper ${lib.getExe nodejs_24} "$out/libexec/pnpm-real" \
      --add-flags "$out/lib/pnpm/bin/pnpm.mjs"
    makeWrapper ${lib.getExe nodejs_24} "$out/libexec/pnpx-real" \
      --add-flags "$out/lib/pnpm/bin/pnpx.mjs"

    cat > "$out/bin/pnpm" <<EOF
    #!${stdenvNoCC.shell}
    if [ "\$#" -eq 4 ] \
      && [ "\$1" = config ] \
      && [ "\$2" = set ] \
      && [ "\$3" = manage-package-manager-versions ] \
      && [ "\$4" = false ]; then
      exit 0
    fi
    exec "$out/libexec/pnpm-real" "\$@"
    EOF
    chmod +x "$out/bin/pnpm"

    ln -s ../libexec/pnpx-real "$out/bin/pnpx"
    ln -s pnpm "$out/bin/pn"
    ln -s pnpx "$out/bin/pnx"

    runHook postInstall
  '';

  meta = {
    description = "Fast, disk space efficient package manager";
    homepage = "https://pnpm.io";
    license = lib.licenses.mit;
    mainProgram = "pnpm";
  };

  passthru.nodejs-slim = nodejs_24;
})
