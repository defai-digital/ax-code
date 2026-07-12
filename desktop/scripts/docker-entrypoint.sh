#!/usr/bin/env sh
set -eu

HOME="/home/openchamber"

AX_CODE_CONFIG_DIR="${AX_CODE_CONFIG_DIR:-${HOME}/.config/ax-code}"
export AX_CODE_CONFIG_DIR

SSH_DIR="${HOME}/.ssh"
SSH_PRIVATE_KEY_PATH="${SSH_DIR}/id_ed25519"
SSH_PUBLIC_KEY_PATH="${SSH_PRIVATE_KEY_PATH}.pub"

mkdir -p "${SSH_DIR}"
if ! chmod 700 "${SSH_DIR}" 2>/dev/null; then
  echo "[entrypoint] warning: cannot chmod ${SSH_DIR}, continuing with existing permissions"
fi

if [ ! -f "${SSH_PRIVATE_KEY_PATH}" ] || [ ! -f "${SSH_PUBLIC_KEY_PATH}" ]; then
  if [ ! -w "${SSH_DIR}" ]; then
    echo "[entrypoint] warning: ssh key missing and ${SSH_DIR} is not writable, continuing without SSH key" >&2
  else
    echo "[entrypoint] generating SSH key..."
    if ! ssh-keygen -t ed25519 -N "" -f "${SSH_PRIVATE_KEY_PATH}" >/dev/null 2>&1; then
      echo "[entrypoint] warning: failed to generate SSH key, continuing without SSH key" >&2
    fi
  fi
fi

if ! chmod 600 "${SSH_PRIVATE_KEY_PATH}" 2>/dev/null; then
  echo "[entrypoint] warning: cannot chmod ${SSH_PRIVATE_KEY_PATH}, continuing"
fi

if ! chmod 644 "${SSH_PUBLIC_KEY_PATH}" 2>/dev/null; then
  echo "[entrypoint] warning: cannot chmod ${SSH_PUBLIC_KEY_PATH}, continuing"
fi

if [ -f "${SSH_PUBLIC_KEY_PATH}" ]; then
  echo "[entrypoint] SSH public key:"
  cat "${SSH_PUBLIC_KEY_PATH}"
fi

# Handle UI password environment variable
if [ -n "${UI_PASSWORD:-}" ]; then
  echo "[entrypoint] UI password set, enabling authentication"
fi

if [ "${OH_MY_AX_CODE:-false}" = "true" ]; then
  OMO_CONFIG_FILE="${AX_CODE_CONFIG_DIR}/oh-my-ax-code.json"

  if [ ! -f "${OMO_CONFIG_FILE}" ]; then
    echo "[entrypoint] npm installing oh-my-ax-code..."
    npm install -g oh-my-ax-code

    OMO_INSTALL_ARGS="--no-tui --claude=no --openai=no --gemini=no --copilot=no --ax-code-zen=no --zai-coding-plan=no --kimi-for-coding=no --skip-auth"

    echo "[entrypoint] oh-my-ax-code installing..."
    oh-my-ax-code install ${OMO_INSTALL_ARGS}
  fi
fi

# AX Code is local-only, including containerized development runtimes.
AX_CODE_DESKTOP_HOST="127.0.0.1"
export AX_CODE_DESKTOP_HOST

echo "[entrypoint] starting..."

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ -f desktop/packages/web/bin/cli.js ]; then
  CLI_ENTRY="desktop/packages/web/bin/cli.js"
else
  CLI_ENTRY="packages/web/bin/cli.js"
fi

set -- node "$CLI_ENTRY"
if [ -n "${UI_PASSWORD:-}" ]; then
  set -- "$@" --ui-password "$UI_PASSWORD"
fi
"$@"

exec node "$CLI_ENTRY" logs
