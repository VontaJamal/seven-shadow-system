#!/usr/bin/env bash
set -euo pipefail

FORCE=0
WITH_BUNDLE_TRUST=0
TRUST_STORE_VERSION="2"
SKIP_README_BADGE=0
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f)
      FORCE=1
      shift
      ;;
    --with-bundle-trust)
      WITH_BUNDLE_TRUST=1
      shift
      ;;
    --skip-readme-badge)
      SKIP_README_BADGE=1
      shift
      ;;
    --trust-store-version)
      if [[ $# -lt 2 ]]; then
        echo "--trust-store-version requires a value of 1 or 2"
        exit 1
      fi
      TRUST_STORE_VERSION="$2"
      if [[ "$TRUST_STORE_VERSION" != "1" && "$TRUST_STORE_VERSION" != "2" ]]; then
        echo "--trust-store-version must be 1 or 2"
        exit 1
      fi
      shift 2
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -lt 1 ]]; then
  echo "Usage: $0 [--force] [--with-bundle-trust --trust-store-version 1|2] [--skip-readme-badge] /absolute/path/to/target-repo [submodule-path]"
  exit 1
fi

if [[ "$WITH_BUNDLE_TRUST" -ne 1 && "$TRUST_STORE_VERSION" != "2" ]]; then
  echo "--trust-store-version is only valid when --with-bundle-trust is set"
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

if [[ "$WITH_BUNDLE_TRUST" -eq 1 ]]; then
  TRUST_STORE_SOURCE="$TARGET_REPO/$SUBMODULE_PATH/config/policy-trust-store.v2.sample.json"
  if [[ "$TRUST_STORE_VERSION" == "1" ]]; then
    TRUST_STORE_SOURCE="$TARGET_REPO/$SUBMODULE_PATH/config/policy-trust-store.sample.json"
  fi

  TRUST_STORE_TARGET="$TARGET_REPO/.seven-shadow/policy-trust-store.json"
  if [[ ! -f "$TRUST_STORE_TARGET" ]]; then
    cp "$TRUST_STORE_SOURCE" "$TRUST_STORE_TARGET"
  else
    echo "Trust store already exists: $TRUST_STORE_TARGET"
  fi

  BUNDLE_TEMPLATE_TARGET="$TARGET_REPO/.seven-shadow/policy.bundle.template.json"
  if [[ ! -f "$BUNDLE_TEMPLATE_TARGET" ]]; then
    cp "$TARGET_REPO/$SUBMODULE_PATH/config/policy-bundle.v2.template.json" "$BUNDLE_TEMPLATE_TARGET"
  else
    echo "Bundle template already exists: $BUNDLE_TEMPLATE_TARGET"
  fi

  QUICKSTART_TARGET="$TARGET_REPO/.seven-shadow/policy-bundle-quickstart.md"
  if [[ ! -f "$QUICKSTART_TARGET" ]]; then
    cp "$TARGET_REPO/$SUBMODULE_PATH/templates/submodule/policy-bundle-quickstart.md" "$QUICKSTART_TARGET"
  else
    echo "Bundle quickstart already exists: $QUICKSTART_TARGET"
  fi
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

README_TARGET="$TARGET_REPO/README.md"
README_TEMPLATE="$TARGET_REPO/$SUBMODULE_PATH/templates/submodule/readme-protection-block.md"
README_MARKER="seven-shadow-system:protection-block:start"
README_PROTECTION_HEADER="## Protected by the [Seven Shadows](https://github.com/VontaJamal/seven-shadow-system)"
README_VAULT_LINK="https://github.com/VontaJamal/shadow-vault"

if [[ "$SKIP_README_BADGE" -eq 1 ]]; then
  echo "Skipping README protection block via --skip-readme-badge."
elif [[ ! -f "$README_TEMPLATE" ]]; then
  echo "README protection template missing and was not applied: $README_TEMPLATE"
else
  if [[ ! -f "$README_TARGET" ]]; then
    touch "$README_TARGET"
  fi

  if grep -Fq "$README_MARKER" "$README_TARGET"; then
    echo "README already contains managed Seven Shadows protection block: $README_TARGET"
  elif grep -Fq "$README_PROTECTION_HEADER" "$README_TARGET" && grep -Fq "$README_VAULT_LINK" "$README_TARGET"; then
    echo "README already contains Seven Shadows protection + Vault link: $README_TARGET"
  else
    if [[ -s "$README_TARGET" ]]; then
      printf "\n\n" >> "$README_TARGET"
    fi
    cat "$README_TEMPLATE" >> "$README_TARGET"
    echo "README protection block added: $README_TARGET"
  fi
fi

echo "Seven Shadow System wired into $TARGET_REPO"
