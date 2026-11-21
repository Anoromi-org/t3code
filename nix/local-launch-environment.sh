#!/usr/bin/env bash

t3code_cleanup_local_launch_environment() {
  if [ -n "${T3CODE_LOCAL_LAUNCH_ENV_FILE:-}" ]; then
    rm -f -- "$T3CODE_LOCAL_LAUNCH_ENV_FILE"
    unset T3CODE_LOCAL_LAUNCH_ENV_FILE
  fi
}
t3code_forward_local_launch_signal() {
  local signal=$1
  local exit_code=$2
  local watchdog_pid

  if [ -n "${t3code_local_launch_child_pid:-}" ]; then
    kill "-$signal" -- "-$t3code_local_launch_child_pid" 2>/dev/null || true
    (
      sleep 2
      kill -KILL -- "-$t3code_local_launch_child_pid" 2>/dev/null || true
    ) &
    watchdog_pid=$!
    wait "$t3code_local_launch_child_pid" 2>/dev/null || true
    kill -KILL -- "-$t3code_local_launch_child_pid" 2>/dev/null || true
    kill "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
    t3code_local_launch_child_pid=
  fi
  exit "$exit_code"
}

t3code_capture_local_launch_environment() {
  local previous_umask

  previous_umask=$(umask)
  umask 077
  T3CODE_LOCAL_LAUNCH_ENV_FILE=$(mktemp "${XDG_RUNTIME_DIR:-/tmp}/t3code-local-env.XXXXXX")
  umask "$previous_umask"

  trap t3code_cleanup_local_launch_environment EXIT
  trap 't3code_forward_local_launch_signal HUP 129' HUP
  trap 't3code_forward_local_launch_signal INT 130' INT
  trap 't3code_forward_local_launch_signal TERM 143' TERM

  env -0 > "$T3CODE_LOCAL_LAUNCH_ENV_FILE"
  export T3CODE_LOCAL_LAUNCH_ENV_FILE
}

t3code_run_local_launch() {
  local exit_code

  setsid env \
    --default-signal=HUP \
    --default-signal=INT \
    --default-signal=TERM \
    -- "$@" &
  t3code_local_launch_child_pid=$!
  if wait "$t3code_local_launch_child_pid"; then
    exit_code=0
  else
    exit_code=$?
  fi
  t3code_local_launch_child_pid=
  return "$exit_code"
}
