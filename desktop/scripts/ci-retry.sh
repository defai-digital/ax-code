#!/usr/bin/env bash
#
# Retry a CI command that can fail on transient network/download errors.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <command> [args ...]" >&2
  exit 2
fi

attempts="${CI_RETRY_ATTEMPTS:-3}"
delay_seconds="${CI_RETRY_DELAY_SECONDS:-20}"

if ! [[ "$attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "CI_RETRY_ATTEMPTS must be a positive integer, got: $attempts" >&2
  exit 2
fi

if ! [[ "$delay_seconds" =~ ^[0-9]+$ ]]; then
  echo "CI_RETRY_DELAY_SECONDS must be a non-negative integer, got: $delay_seconds" >&2
  exit 2
fi

attempt=1
while true; do
  set +e
  "$@"
  status="$?"
  set -e

  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::Command failed after $attempt attempts: $*" >&2
    exit "$status"
  fi

  next_attempt=$((attempt + 1))
  echo "::warning::Command failed with exit code $status (attempt $attempt/$attempts). Retrying in ${delay_seconds}s: $*" >&2
  sleep "$delay_seconds"

  attempt="$next_attempt"
  delay_seconds=$((delay_seconds * 2))
done
