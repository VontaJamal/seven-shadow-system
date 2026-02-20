#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /absolute/path/to/target-repo [submodule-path]"
  exit 1
fi

TARGET_REPO="$1"
SUBMODULE_PATH="${2:-governance/seven-shadow-system}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_URL="$(git -C "$SELF_DIR" config --get remote.origin.url || true)"

if [[ -z "$SELF_URL" ]]; then
  echo "Unable to detect origin URL for Seven Shadow System. Set remote first."
  exit 1
fi

if [[ ! -d "$TARGET_REPO/.git" ]]; then
  echo "Target is not a git repository: $TARGET_REPO"
  exit 1
fi

if [[ ! -d "$TARGET_REPO/$SUBMODULE_PATH" ]]; then
  git -C "$TARGET_REPO" submodule add "$SELF_URL" "$SUBMODULE_PATH"
else
  echo "Submodule path already exists: $SUBMODULE_PATH"
fi

mkdir -p "$TARGET_REPO/.seven-shadow" "$TARGET_REPO/.github/workflows"

if [[ ! -f "$TARGET_REPO/.seven-shadow/policy.json" ]]; then
  cp "$TARGET_REPO/$SUBMODULE_PATH/config/seven-shadow-system.policy.json" "$TARGET_REPO/.seven-shadow/policy.json"
fi

cp "$TARGET_REPO/$SUBMODULE_PATH/templates/workflows/seven-shadow-system.yml" "$TARGET_REPO/.github/workflows/seven-shadow-system.yml"

echo "Seven Shadow System wired into $TARGET_REPO"
