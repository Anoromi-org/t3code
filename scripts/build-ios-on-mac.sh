#!/usr/bin/env bash
# Builds a signed iOS app with `eas build --local` on a Mac reached over SSH, then copies the
# .ipa to apps/mobile/build/ and optionally uploads it to EAS for an install link.
#
# The Mac needs Xcode, CocoaPods, Fastlane, Node 24 with corepack, an Expo login
# (`eas login`), Apple's WWDR intermediate certificates in the System keychain, and a user
# logged in to its desktop. Signing runs as a launchd job in that desktop session because
# macOS SSH sessions do not search user keychains, so Xcode cannot find EAS's signing identity.
#
# Usage: scripts/build-ios-on-mac.sh --host user@mac [--profile preview] [--upload]
#   --host        SSH target (default: $T3_IOS_BUILD_HOST)
#   --profile     EAS build profile (default: preview)
#   --upload      Upload the .ipa with `eas upload` and print its install link
#   --remote-dir  Checkout path on the Mac, relative to its home (default: code/t3code)
#   --remote-env  Command prefix that provides Node 24 and pnpm on the Mac
#                 (default: $T3_IOS_BUILD_ENV, else none)
set -euo pipefail

host=${T3_IOS_BUILD_HOST:-}
profile=preview
upload=false
remote_dir=code/t3code
remote_env=${T3_IOS_BUILD_ENV:-}

while (($# > 0)); do
  case $1 in
    --host) host=$2; shift 2 ;;
    --profile) profile=$2; shift 2 ;;
    --upload) upload=true; shift ;;
    --remote-dir) remote_dir=$2; shift 2 ;;
    --remote-env) remote_env=$2; shift 2 ;;
    -h | --help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf '%s: unknown argument %s\n' "$0" "$1" >&2; exit 2 ;;
  esac
done

if [[ -z $host ]]; then
  printf '%s: pass --host user@mac or set T3_IOS_BUILD_HOST\n' "$0" >&2
  exit 2
fi
if [[ ! $profile =~ ^[A-Za-z0-9:_-]+$ ]]; then
  printf '%s: invalid profile %s\n' "$0" "$profile" >&2
  exit 2
fi

repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
output_dir="$repo_root/apps/mobile/build"
ipa_name="t3code-$profile.ipa"
label="com.t3code.ios-build"

printf '==> Syncing %s to %s:%s\n' "$repo_root" "$host" "$remote_dir"
ssh "$host" "mkdir -p '$remote_dir'"
# Generated and installed directories stay on the Mac; deleting them forces slow reinstalls.
rsync -az --delete \
  --exclude=node_modules --exclude=.git --exclude=.repos --exclude=.t3 \
  --exclude=/apps/mobile/ios --exclude=/apps/mobile/android --exclude=/apps/mobile/build \
  --filter=':- .gitignore' \
  "$repo_root/" "$host:$remote_dir/"

# The remote script runs from the Mac's login shell so its Node and pnpm setup applies.
remote_args=$(printf '%q ' "$remote_dir" "$profile" "$ipa_name" "$label" "$remote_env" "$upload")
ssh "$host" "/bin/zsh -l -s -- $remote_args" <<'REMOTE'
set -eu
remote_dir=$1 profile=$2 ipa_name=$3 label=$4 remote_env=$5 upload=$6
cd "$HOME/$remote_dir"

# EAS local builds archive the project through git, so keep a throwaway snapshot repository.
[[ -d .git ]] || git init -q
git add -A >/dev/null
git -c user.name=ios-build -c user.email=ios-build@localhost commit -qm "ios build snapshot" --allow-empty

echo "==> Installing dependencies"
eval "CI=1 $remote_env pnpm install --frozen-lockfile" > /tmp/t3code-ios-install.log 2>&1 \
  || { tail -30 /tmp/t3code-ios-install.log; exit 1; }

# Outside the checkout, so build state never lands in the archived snapshot.
state_dir="$HOME/.cache/t3code-ios-build"
log="$state_dir/build.log"
mkdir -p "$state_dir"
rm -f "$log" "$state_dir/$ipa_name"
cat > "$state_dir/run.sh" <<RUN
#!/bin/zsh -l
cd "$HOME/$remote_dir/apps/mobile"
$remote_env npx -y eas-cli@latest build --local --profile "$profile" --platform ios \
  --non-interactive --output "$state_dir/$ipa_name" > "$log" 2>&1
echo "EXIT=\$?" >> "$log"
RUN
chmod +x "$state_dir/run.sh"
cat > "$state_dir/job.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array><string>$state_dir/run.sh</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
PLIST

echo "==> Building '$profile' in the desktop session (log: $log)"
domain="gui/$(id -u)"
launchctl bootout "$domain/$label" 2>/dev/null || true
if ! launchctl bootstrap "$domain" "$state_dir/job.plist"; then
  echo "Could not start the build in $domain. Is a user logged in to the Mac's desktop?" >&2
  exit 1
fi
until grep -q '^EXIT=' "$log" 2>/dev/null; do sleep 10; done
launchctl bootout "$domain/$label" 2>/dev/null || true
if ! grep -q '^EXIT=0' "$log"; then
  grep -E '❌|error:|Error:' "$log" | sort -u | tail -20
  exit 1
fi

if [[ $upload == true ]]; then
  echo "==> Uploading to EAS"
  cd "$HOME/$remote_dir/apps/mobile"
  eval "$remote_env npx -y eas-cli@latest upload --platform ios --build-path '$state_dir/$ipa_name' --non-interactive" 2>&1 \
    | grep -E 'Shareable link|Error' || true
fi
REMOTE

mkdir -p "$output_dir"
scp -q "$host:.cache/t3code-ios-build/$ipa_name" "$output_dir/$ipa_name"
printf '==> Built %s\n' "$output_dir/$ipa_name"
