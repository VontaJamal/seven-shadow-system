#!/usr/bin/env bash
set -euo pipefail

FORCE=0
TRUST_STORE_VERSION="2"
SUBMODULE_PATH="governance/seven-shadow-system"
POSITIONAL=()

function fail() {
  local code="$1"
  local message="$2"
  echo "${code}: ${message}" >&2
  exit 1
}

function escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f)
      FORCE=1
      shift
      ;;
    --trust-store-version)
      if [[ $# -lt 2 ]]; then
        fail "E_TRUST_ROLLOUT_ARG_REQUIRED" "--trust-store-version requires a value of 1 or 2"
      fi
      TRUST_STORE_VERSION="$2"
      if [[ "$TRUST_STORE_VERSION" != "1" && "$TRUST_STORE_VERSION" != "2" ]]; then
        fail "E_TRUST_ROLLOUT_ARG_REQUIRED" "--trust-store-version must be 1 or 2"
      fi
      shift 2
      ;;
    --submodule-path)
      if [[ $# -lt 2 ]]; then
        fail "E_TRUST_ROLLOUT_ARG_REQUIRED" "--submodule-path requires a value"
      fi
      SUBMODULE_PATH="$2"
      shift 2
      ;;
    --*)
      fail "E_TRUST_ROLLOUT_ARG_REQUIRED" "unknown option '$1'"
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ne 1 ]]; then
  fail "E_TRUST_ROLLOUT_ARG_REQUIRED" "usage: bootstrap-trust-rollout.sh [--force] [--trust-store-version 1|2] [--submodule-path <path>] <target-repo>"
fi

TARGET_REPO="${POSITIONAL[0]}"
SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIRE_SCRIPT="$SELF_ROOT/scripts/wire-submodule.sh"
PR_TEMPLATE_SOURCE="$SELF_ROOT/templates/submodule/trust-rollout-pr-template.md"

if [[ ! -d "$TARGET_REPO/.git" ]]; then
  fail "E_TRUST_ROLLOUT_TARGET_INVALID" "target repository must be a git repository: $TARGET_REPO"
fi

if [[ ! -x "$WIRE_SCRIPT" ]]; then
  fail "E_TRUST_ROLLOUT_SUBMODULE_INVALID" "wire-submodule script not found or not executable: $WIRE_SCRIPT"
fi

WIRE_ARGS=("$WIRE_SCRIPT")
if [[ "$FORCE" -eq 1 ]]; then
  WIRE_ARGS+=("--force")
fi
WIRE_ARGS+=("--with-bundle-trust" "--trust-store-version" "$TRUST_STORE_VERSION" "$TARGET_REPO" "$SUBMODULE_PATH")
"${WIRE_ARGS[@]}"

SUBMODULE_ROOT="$TARGET_REPO/$SUBMODULE_PATH"
if [[ ! -d "$SUBMODULE_ROOT" ]]; then
  fail "E_TRUST_ROLLOUT_SUBMODULE_INVALID" "submodule path does not exist after wiring: $SUBMODULE_ROOT"
fi

TRUST_STORE_PATH="$TARGET_REPO/.seven-shadow/policy-trust-store.json"
if [[ ! -f "$TRUST_STORE_PATH" ]]; then
  fail "E_TRUST_ROLLOUT_SUBMODULE_INVALID" "missing trust store after wiring: $TRUST_STORE_PATH"
fi

LINT_SCRIPT="$SUBMODULE_ROOT/dist/scripts/policy-trust-store.js"
if [[ ! -f "$LINT_SCRIPT" && -f "$SUBMODULE_ROOT/package.json" ]]; then
  (
    cd "$SUBMODULE_ROOT"
    npm run build >/dev/null
  )
fi

if [[ ! -f "$LINT_SCRIPT" ]]; then
  fail "E_TRUST_ROLLOUT_SUBMODULE_INVALID" "cannot locate trust lint entrypoint: $LINT_SCRIPT"
fi

TEMP_LINT_OUTPUT="$(mktemp)"
if ! node "$LINT_SCRIPT" lint --trust-store "$TRUST_STORE_PATH" --format json >"$TEMP_LINT_OUTPUT"; then
  rm -f "$TEMP_LINT_OUTPUT"
  fail "E_TRUST_ROLLOUT_LINT_FAILED" "trust-store lint failed for $TRUST_STORE_PATH"
fi

ROLLOUT_DIR="$TARGET_REPO/.seven-shadow/trust-rollout"
LINT_SNAPSHOT_PATH="$ROLLOUT_DIR/trust-lint.json"
PR_TEMPLATE_PATH="$ROLLOUT_DIR/pr-template.md"
mkdir -p "$ROLLOUT_DIR"

if [[ "$FORCE" -eq 1 || ! -f "$LINT_SNAPSHOT_PATH" ]]; then
  cp "$TEMP_LINT_OUTPUT" "$LINT_SNAPSHOT_PATH"
else
  echo "Trust lint snapshot already exists and was not overwritten: $LINT_SNAPSHOT_PATH"
fi
rm -f "$TEMP_LINT_OUTPUT"

if [[ ! -f "$PR_TEMPLATE_SOURCE" ]]; then
  fail "E_TRUST_ROLLOUT_SUBMODULE_INVALID" "missing PR template source: $PR_TEMPLATE_SOURCE"
fi

if [[ "$FORCE" -eq 1 || ! -f "$PR_TEMPLATE_PATH" ]]; then
  now_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  escaped_target_repo="$(escape_sed_replacement "$TARGET_REPO")"
  escaped_submodule_path="$(escape_sed_replacement "$SUBMODULE_PATH")"
  escaped_trust_store_path="$(escape_sed_replacement ".seven-shadow/policy-trust-store.json")"
  escaped_policy_bundle_template_path="$(escape_sed_replacement ".seven-shadow/policy.bundle.template.json")"
  escaped_lint_snapshot_path="$(escape_sed_replacement ".seven-shadow/trust-rollout/trust-lint.json")"
  escaped_generated_at="$(escape_sed_replacement "$now_utc")"
  escaped_trust_store_version="$(escape_sed_replacement "$TRUST_STORE_VERSION")"

  sed \
    -e "s/{{TARGET_REPO}}/${escaped_target_repo}/g" \
    -e "s/{{SUBMODULE_PATH}}/${escaped_submodule_path}/g" \
    -e "s/{{TRUST_STORE_PATH}}/${escaped_trust_store_path}/g" \
    -e "s/{{POLICY_BUNDLE_TEMPLATE_PATH}}/${escaped_policy_bundle_template_path}/g" \
    -e "s/{{LINT_SNAPSHOT_PATH}}/${escaped_lint_snapshot_path}/g" \
    -e "s/{{GENERATED_AT}}/${escaped_generated_at}/g" \
    -e "s/{{TRUST_STORE_VERSION}}/${escaped_trust_store_version}/g" \
    "$PR_TEMPLATE_SOURCE" >"$PR_TEMPLATE_PATH"
else
  echo "Rollout PR template already exists and was not overwritten: $PR_TEMPLATE_PATH"
fi

echo "Trust rollout bootstrap completed for $TARGET_REPO"
echo "- trust store: $TRUST_STORE_PATH"
echo "- lint snapshot: $LINT_SNAPSHOT_PATH"
echo "- PR template: $PR_TEMPLATE_PATH"
