{
  lib,
  name,
  rustPlatform,
}:

# Builds one of the pure-Rust desktop helpers under native/. Upstream CI owns
# their cargo tests; the package only needs the release binary.
rustPlatform.buildRustPackage {
  pname = "t3-${name}";
  version = "0.1.0";
  src = lib.cleanSource (../native + "/${name}");
  cargoLock.lockFile = ../native + "/${name}/Cargo.lock";
  doCheck = false;
  meta.mainProgram = "t3-${name}";
}
