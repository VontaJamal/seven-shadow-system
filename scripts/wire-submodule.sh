#!/usr/bin/env bash
set -euo pipefail

FORCE=0
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f)
      FORCE=1
      shift
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -lt 1 ]]; then
  echo "Usage: $0 [--force] /absolute/path/to/target-repo [submodule-path]"
  exit 1
fi

TARGET_REPO="${POSITIONAL[0]}"
SUBMODULE_PATH="${POSITIONAL[1]:-governance/seven-shadow-system}"
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
else
  echo "Policy already exists: $TARGET_REPO/.seven-shadow/policy.json"
fi

WORKFLOW_TARGET="$TARGET_REPO/.github/workflows/seven-shadow-system.yml"
if [[ -f "$WORKFLOW_TARGET" && "$FORCE" -ne 1 ]]; then
  echo "Workflow already exists and was not overwritten: $WORKFLOW_TARGET"
  echo "Use --force to overwrite the workflow template."
else
  cp "$TARGET_REPO/$SUBMODULE_PATH/templates/workflows/seven-shadow-system.yml" "$WORKFLOW_TARGET"
  if [[ "$FORCE" -eq 1 ]]; then
    echo "Workflow overwritten via --force: $WORKFLOW_TARGET"
  fi
fi

echo "Seven Shadow System wired into $TARGET_REPO"
