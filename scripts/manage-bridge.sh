#!/bin/sh
set -eu

ACTION="${1:-}"
LABEL="com.lawrenceawe.job-search-companion"
ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd -P)
PLIST_SOURCE="$ROOT/launchd/$LABEL.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_STATE="$HOME/Library/Application Support/Job Search Companion/install-state.json"
EXTENSION_CONFIG="$ROOT/extension/local-config.js"
ACCESSIBILITY_HELPER="$HOME/Library/Application Support/Job Search Companion/accessibility-helper"
DOMAIN="gui/$(id -u)"
LEGACY_LABEL="com.lawrenceawe.indeed-cv-fit-bridge"
LEGACY_DIRECTORY="$HOME/Library/Application Support/Indeed CV Fit Bridge"
DATA_DIRECTORY="$HOME/Library/Application Support/Job Search Companion"
migration_started=false
legacy_was_loaded=false
migration_backup=

begin_legacy_migration() {
  [ -d "$LEGACY_DIRECTORY" ] || return 0
  if [ -e "$DATA_DIRECTORY" ]; then
    echo "Both bridge data directories exist; resolve them before installing." >&2
    exit 1
  fi
  migration_backup=$(mktemp -d "${TMPDIR:-/tmp}/jsc-migration.XXXXXX")
  chmod 700 "$migration_backup"
  cp -pR "$LEGACY_DIRECTORY" "$migration_backup/data"
  if launchctl print "$DOMAIN/$LEGACY_LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LEGACY_LABEL"
    legacy_was_loaded=true
  fi
  migration_started=true
  if ! node "$ROOT/scripts/bridge-install-cli.js" migrate-installation --home-path "$HOME"; then
    rollback_legacy_migration
    exit 1
  fi
}

rollback_legacy_migration() {
  [ "$migration_started" = true ] || return 0
  if [ -d "$DATA_DIRECTORY" ] && [ ! -e "$LEGACY_DIRECTORY" ]; then
    mv "$DATA_DIRECTORY" "$LEGACY_DIRECTORY"
  fi
  # Startup may already have migrated account fields before a later health failure.
  # Restore the complete pre-migration snapshot so the prior reader keeps working.
  cp -pR "$migration_backup/data/." "$LEGACY_DIRECTORY/"
  if [ "$legacy_was_loaded" = true ]; then
    launchctl bootstrap "$DOMAIN" "$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist" \
      || echo "The previous service could not be restarted. Restore its checkout revision before retrying." >&2
  fi
  rm -rf "$migration_backup"
  migration_started=false
}

finish_legacy_migration() {
  if [ -n "$migration_backup" ]; then rm -rf "$migration_backup"; fi
  migration_started=false
}

backup_current_installation() {
  installation_backup=$(mktemp -d "${TMPDIR:-/tmp}/jsc-backup.XXXXXX")
  snapshot_managed_file "$EXTENSION_CONFIG" extension-config
  snapshot_managed_file "$PLIST_TARGET" launch-agent
  snapshot_managed_file "$ACCESSIBILITY_HELPER" accessibility-helper
  snapshot_managed_file "$INSTALL_STATE" install-state
  managed_artifacts="$installation_backup/managed-artifacts"
  node "$ROOT/scripts/bridge-install-cli.js" managed-artifact-paths \
    --state-path "$INSTALL_STATE" > "$managed_artifacts" || return 1
  while IFS="$(printf '\t')" read -r artifact_name artifact_path; do
    [ -n "$artifact_name" ] || continue
    snapshot_managed_file "$artifact_path" "managed-$artifact_name"
  done < "$managed_artifacts"
}

snapshot_managed_file() {
  source_path=$1
  snapshot_name=$2
  if [ -e "$source_path" ]; then
    cp -p "$source_path" "$installation_backup/$snapshot_name"
    : > "$installation_backup/$snapshot_name.present"
  fi
}

restore_current_installation() {
  restore_managed_file "$EXTENSION_CONFIG" extension-config
  restore_managed_file "$PLIST_TARGET" launch-agent
  restore_managed_file "$ACCESSIBILITY_HELPER" accessibility-helper
  restore_managed_file "$INSTALL_STATE" install-state
  while IFS="$(printf '\t')" read -r artifact_name artifact_path; do
    [ -n "$artifact_name" ] || continue
    restore_managed_file "$artifact_path" "managed-$artifact_name"
  done < "$installation_backup/managed-artifacts"
}

restore_managed_file() {
  target_path=$1
  snapshot_name=$2
  rm -f "$target_path"
  if [ -f "$installation_backup/$snapshot_name.present" ]; then
    mkdir -p "$(dirname "$target_path")"
    cp -p "$installation_backup/$snapshot_name" "$target_path"
  fi
}

cleanup_installation_backup() {
  if [ -n "${installation_backup:-}" ]; then
    rm -rf "$installation_backup"
    installation_backup=
  fi
}

start_launch_agent() {
  attempt=1
  started=false
  while [ "$attempt" -lt 5 ]; do
    if launchctl bootstrap "$DOMAIN" "$PLIST_TARGET" 2>/dev/null; then
      started=true
      break
    fi
    attempt=$((attempt + 1))
    sleep 0.2
  done
  if [ "$started" = false ]; then
    launchctl bootstrap "$DOMAIN" "$PLIST_TARGET"
  fi
  launchctl enable "$DOMAIN/$LABEL"
  launchctl kickstart -k "$DOMAIN/$LABEL"
}

wait_for_bridge_health() {
  attempt=1
  while [ "$attempt" -le 20 ]; do
    if JSC_BRIDGE_INSTANCE_ID="$bridge_instance_id" node "$ROOT/scripts/check-health.js" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.25
  done
  return 1
}

start_verified_launch_agent() {
  start_launch_agent
  wait_for_bridge_health
}

stop_launch_agent() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LABEL"
    return 0
  fi
  return 1
}

install_bridge() {
  node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Job Search Companion requires Node.js 22 or newer. Update the node command before installing."); process.exit(1); }'
  : "${JSC_BRIDGE_TOKEN:?Set JSC_BRIDGE_TOKEN; the installer writes it to extension/local-config.js}"
  : "${JSC_EXTENSION_ORIGIN:?Set JSC_EXTENSION_ORIGIN to chrome-extension://<extension-id>}"

  case "$JSC_BRIDGE_TOKEN" in
    *[!A-Za-z0-9._-]*)
      echo "JSC_BRIDGE_TOKEN may only contain letters, numbers, dots, underscores, and hyphens" >&2
      exit 1
      ;;
  esac
  case "$JSC_EXTENSION_ORIGIN" in
    chrome-extension://[a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p]) ;;
    *)
      echo "JSC_EXTENSION_ORIGIN must look like chrome-extension://<32-character-extension-id>" >&2
      exit 1
      ;;
  esac

  WORKSPACE_PATH="${JSC_WORKSPACE:-$HOME/CV Fit Advisor}"
  LOG_PATH="${JSC_LOG_PATH:-$HOME/Library/Application Support/Job Search Companion/bridge.log}"
  bridge_instance_id=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')

  helper_build_directory=$(mktemp -d "${TMPDIR:-/tmp}/jsc-helper.XXXXXX")
  helper_binary="$helper_build_directory/accessibility-helper"
  cleanup_helper() {
    rm -f "$helper_binary"
    rmdir "$helper_build_directory" 2>/dev/null || true
  }
  trap cleanup_helper EXIT HUP INT TERM
  /usr/bin/swiftc -O "$ROOT/bridge/codex/accessibility-helper"/*.swift -o "$helper_binary"
  chmod 700 "$helper_binary"

  begin_legacy_migration
  if ! backup_current_installation; then
    rollback_legacy_migration
    exit 1
  fi
  was_loaded=false
  if stop_launch_agent; then
    was_loaded=true
  fi

  if ! node "$ROOT/scripts/bridge-install-cli.js" install \
    --state-path "$INSTALL_STATE" \
    --extension-config-path "$ROOT/extension/local-config.js" \
    --plist-source "$PLIST_SOURCE" \
    --plist-target "$PLIST_TARGET" \
    --accessibility-helper-source "$helper_binary" \
    --accessibility-helper-target "$HOME/Library/Application Support/Job Search Companion/accessibility-helper" \
    --root-path "$ROOT" \
    --workspace-path "$WORKSPACE_PATH" \
    --log-path "$LOG_PATH" \
    --token "$JSC_BRIDGE_TOKEN" \
    --allowed-extension-origin "$JSC_EXTENSION_ORIGIN" \
    --instance-id "$bridge_instance_id"; then
    if [ "$was_loaded" = true ] && [ -f "$PLIST_TARGET" ]; then
      start_launch_agent || echo "The previous LaunchAgent could not be restarted." >&2
    fi
    cleanup_installation_backup
    rollback_legacy_migration
    exit 1
  fi

  if ! start_verified_launch_agent; then
    echo "Could not start $LABEL; restoring the previous installation." >&2
    stop_launch_agent || true
    if ! restore_current_installation; then
      echo "Could not restore the previous installation automatically." >&2
      cleanup_installation_backup
      rollback_legacy_migration
      exit 1
    fi
    if [ "$was_loaded" = true ] && [ -f "$PLIST_TARGET" ]; then
      if ! start_launch_agent; then
        echo "The previous LaunchAgent could not be restarted." >&2
      fi
    fi
    cleanup_installation_backup
    rollback_legacy_migration
    exit 1
  fi
  cleanup_installation_backup
  finish_legacy_migration
  cleanup_helper
  trap - EXIT HUP INT TERM
  echo "Installed and started $LABEL"
}

uninstall_bridge() {
  was_loaded=false
  if stop_launch_agent; then
    was_loaded=true
  fi
  if ! node "$ROOT/scripts/bridge-install-cli.js" uninstall --state-path "$INSTALL_STATE"; then
    if [ "$was_loaded" = true ] && [ -f "$PLIST_TARGET" ]; then
      start_launch_agent
    fi
    exit 1
  fi
  echo "Uninstalled $LABEL"
}

case "$ACTION" in
  install) install_bridge ;;
  uninstall) uninstall_bridge ;;
  *) echo "Usage: $0 install|uninstall" >&2; exit 2 ;;
esac
