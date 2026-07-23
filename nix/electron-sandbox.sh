sandbox_args=()
sandbox_helper=${2:-/run/wrappers/bin/chrome-sandbox}
sandbox_stat=${3:-stat}
sandbox_true=${4:-true}

if [[ ${T3CODE_DESKTOP_DISABLE_SANDBOX:-0} == 1 ]]; then
  unset CHROME_DEVEL_SANDBOX
  sandbox_args+=(--no-sandbox)
elif [[ -x $sandbox_helper ]] &&
  [[ $("$sandbox_stat" -c %u -- "$sandbox_helper" 2>/dev/null) == 0 ]] &&
  [[ $("$sandbox_stat" -c %a -- "$sandbox_helper" 2>/dev/null) == 4755 ]]; then
  export CHROME_DEVEL_SANDBOX=$sandbox_helper
elif "$1" -Ur "$sandbox_true" 2>/dev/null; then
  # Keep nixpkgs' non-setuid helper path defined. Electron reads the variable
  # during sandbox initialization, while this flag ensures it uses user
  # namespaces instead of attempting to execute that immutable helper.
  sandbox_args+=(--disable-setuid-sandbox)
else
  unset CHROME_DEVEL_SANDBOX
  sandbox_args+=(--no-sandbox)
fi

unset sandbox_helper sandbox_stat sandbox_true
