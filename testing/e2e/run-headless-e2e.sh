#!/usr/bin/env bash
# ABOUTME: Runs deterministic headless E2E matrix for CLI/config and tracker/worktree paths.
# Validates JSON and beads-rust workflows with isolated throwaway workspaces.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOCK_AGENT="$SCRIPT_DIR/mock-agent.sh"
SETUP_WORKSPACE="$SCRIPT_DIR/setup-throwaway-workspace.sh"

WORK_ROOT="${E2E_WORK_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/ralph-tui-e2e-run-XXXXXX")}" 
CASES="${E2E_CASES:-json-cli,json-config,beads-cli,beads-config,beads-resume,json-external-prd-worktree}"

log() {
  printf '[e2e] %s\n' "$*"
}

fail() {
  printf '[e2e] FAIL: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "missing required command: $1"
  fi
}

should_run_case() {
  local name="$1"
  [[ ",$CASES," == *",$name,"* ]]
}

cleanup() {
  local exit_code=$?

  if [[ "$exit_code" -ne 0 ]]; then
    log "workspace retained for debugging: $WORK_ROOT"
    return
  fi

  if [[ "${KEEP_E2E_WORKSPACE:-0}" == "1" ]]; then
    log "workspace retained (KEEP_E2E_WORKSPACE=1): $WORK_ROOT"
    return
  fi

  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

run_ralph() {
  local ws="$1"
  shift

  (
    cd "$ws"
    bun "$REPO_ROOT/src/cli.tsx" run "$@"
  )
}

workspace_for() {
  local name="$1"
  "$SETUP_WORKSPACE" "$WORK_ROOT/$name"
}

write_base_config() {
  local ws="$1"

  mkdir -p "$ws/.ralph-tui"
  cat > "$ws/.ralph-tui/config.toml" << CONFIG_EOF
configVersion = "2.1"
agent = "claude"
command = '$MOCK_AGENT'
maxIterations = 50
iterationDelay = 0
autoCommit = true
CONFIG_EOF
}

assert_worktree_cleaned() {
  local ws="$1"

  local wt_count
  wt_count="$(git -C "$ws" worktree list --porcelain | grep -c '^worktree ')"
  [[ "$wt_count" -eq 1 ]] || fail "expected 1 active worktree in $ws, got $wt_count"

  if git -C "$ws" branch --list 'ralph-session/*' | grep -q '[^[:space:]]'; then
    fail "session worktree branch was not cleaned up in $ws"
  fi
}

assert_worktree_preserved() {
  local ws="$1"

  local wt_count
  wt_count="$(git -C "$ws" worktree list --porcelain | grep -c '^worktree ')"
  [[ "$wt_count" -ge 2 ]] || fail "expected preserved worktree in $ws, got $wt_count active worktrees"

  if ! git -C "$ws" branch --list 'ralph-session/*' | grep -q '[^[:space:]]'; then
    fail "expected preserved session worktree branch in $ws"
  fi
}

assert_session_lifecycle_cleaned() {
  local ws="$1"

  [[ ! -f "$ws/.ralph-tui/ralph.lock" ]] || fail "stale lock file remained in $ws"
  [[ ! -f "$ws/.ralph-tui/session.json" ]] || fail "session file remained in $ws"
}

assert_iteration_logs_preserved() {
  local ws="$1"
  local logs_dir="$ws/.ralph-tui/iterations"

  [[ -d "$logs_dir" ]] || fail "iteration logs directory missing in $ws"
  find "$logs_dir" -maxdepth 1 -type f -name '*.log' | grep -q . || fail "no iteration logs preserved in $ws"
}

assert_json_completed() {
  local ws="$1"

  jq -e '.userStories | all(.passes == true)' "$ws/test-prd.json" >/dev/null || fail "json tracker did not complete all stories"
  [[ -f "$ws/summary.txt" ]] || fail "summary.txt missing from json workflow"
}

assert_json_outputs_created() {
  local ws="$1"

  [[ -f "$ws/output-a.txt" ]] || fail "output-a.txt missing from json workflow"
  [[ -f "$ws/output-b.txt" ]] || fail "output-b.txt missing from json workflow"
  [[ -f "$ws/output-c.txt" ]] || fail "output-c.txt missing from json workflow"
  [[ -f "$ws/merged-ab.txt" ]] || fail "merged-ab.txt missing from json workflow"
  [[ -f "$ws/summary.txt" ]] || fail "summary.txt missing from json workflow"
}

create_beads_epic() {
  local ws="$1"

  (
    cd "$ws"
    br init >/dev/null

    local epic_id t1 t2 t3
    epic_id="$(br create --title "E2E beads-rust epic" --type epic --priority 1 --silent)"

    t1="$(br create --title "E2E-BR-001 create br-a.txt" --type task --priority 1 --parent "$epic_id" --silent)"
    t2="$(br create --title "E2E-BR-002 create br-b.txt" --type task --priority 1 --parent "$epic_id" --silent)"
    t3="$(br create --title "E2E-BR-003 create br-summary.txt" --type task --priority 2 --parent "$epic_id" --silent)"

    br dep add "$t3" "$t1" >/dev/null
    br dep add "$t3" "$t2" >/dev/null

    # Seed baseline tracker state on main branch so session worktree merge
    # does not fail due untracked .beads files in the parent workspace.
    git add .beads
    git commit -m "chore: seed beads epic for e2e" >/dev/null

    printf '%s\n' "$epic_id"
  )
}

assert_beads_completed() {
  local ws="$1"
  local epic_id="$2"

  (
    cd "$ws"
    br show "$epic_id" --json | jq -e '
      .[0] as $epic
      | [($epic.dependents // [])[] | select(.dependency_type == "parent-child")] as $children
      | ($children | length) >= 3
      and all($children[]; .status == "closed")
    ' >/dev/null
  ) || fail "beads-rust tasks were not all closed for epic $epic_id"

  [[ -f "$ws/br-summary.txt" ]] || fail "br-summary.txt missing from beads workflow"
}

run_case_json_cli() {
  local ws
  ws="$(workspace_for json-cli)"
  write_base_config "$ws"

  log "case json-cli: $ws"
  run_ralph "$ws" \
    --headless \
    --no-setup \
    --cwd "$ws" \
    --tracker json \
    --prd "test-prd.json" \
    --iterations 50

  assert_json_completed "$ws"
}

run_case_json_config() {
  local ws
  ws="$(workspace_for json-config)"
  write_base_config "$ws"

  cat >> "$ws/.ralph-tui/config.toml" << CONFIG_EOF
tracker = "json"

[trackerOptions]
path = "test-prd.json"
CONFIG_EOF

  log "case json-config: $ws"
  run_ralph "$ws" \
    --headless \
    --no-setup \
    --cwd "$ws" \
    --iterations 50

  assert_json_completed "$ws"
}

run_case_beads_cli() {
  local ws epic_id
  ws="$(workspace_for beads-cli)"
  write_base_config "$ws"
  epic_id="$(create_beads_epic "$ws")"

  log "case beads-cli: $ws (epic $epic_id)"
  run_ralph "$ws" \
    --headless \
    --no-setup \
    --cwd "$ws" \
    --tracker beads-rust \
    --epic "$epic_id" \
    --worktree \
    --iterations 50

  assert_beads_completed "$ws" "$epic_id"
  assert_worktree_cleaned "$ws"
  assert_session_lifecycle_cleaned "$ws"
  assert_iteration_logs_preserved "$ws"
}

run_case_beads_config() {
  local ws epic_id
  ws="$(workspace_for beads-config)"
  write_base_config "$ws"
  epic_id="$(create_beads_epic "$ws")"

  cat >> "$ws/.ralph-tui/config.toml" << CONFIG_EOF
tracker = "beads-rust"
worktree = true

[trackerOptions]
epicId = "$epic_id"
CONFIG_EOF

  log "case beads-config: $ws (epic $epic_id)"
  run_ralph "$ws" \
    --headless \
    --no-setup \
    --cwd "$ws" \
    --iterations 50

  assert_beads_completed "$ws" "$epic_id"
  assert_worktree_cleaned "$ws"
  assert_session_lifecycle_cleaned "$ws"
  assert_iteration_logs_preserved "$ws"
}

run_case_beads_resume() {
  local ws epic_id session_worktree
  ws="$(workspace_for beads-resume)"
  write_base_config "$ws"
  epic_id="$(create_beads_epic "$ws")"

  log "case beads-resume: $ws (epic $epic_id)"
  run_ralph "$ws" \
    --headless \
    --no-setup \
    --cwd "$ws" \
    --tracker beads-rust \
    --epic "$epic_id" \
    --worktree \
    --iterations 1

  assert_worktree_preserved "$ws"

  session_worktree="$(git -C "$ws" worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$ws$" | head -n1)"
  [[ -n "$session_worktree" ]] || fail "failed to locate preserved session worktree for $ws"

  (
    cd "$session_worktree"
    printf 'resume sentinel\n' > resume-sentinel.txt
    git add resume-sentinel.txt
    git commit -m "test: preserve worktree state on resume" >/dev/null
  )

  run_ralph "$ws" \
    --headless \
    --no-setup \
    --cwd "$ws" \
    --tracker beads-rust \
    --epic "$epic_id" \
    --worktree \
    --resume \
    --iterations 50

  assert_beads_completed "$ws" "$epic_id"
  [[ -f "$ws/resume-sentinel.txt" ]] || fail "resume sentinel was not merged back into main workspace"
  assert_worktree_cleaned "$ws"
  assert_session_lifecycle_cleaned "$ws"
  assert_iteration_logs_preserved "$ws"
}

run_case_json_external_prd_worktree() {
  local ws external_prd before_cksum after_cksum run_output worktree_path rebased_prd_path
  ws="$(workspace_for json-external-prd-worktree)"
  write_base_config "$ws"

  external_prd="$WORK_ROOT/external-json-prd.json"
  cp "$ws/test-prd.json" "$external_prd"
  before_cksum="$(cksum "$external_prd" | awk '{print $1 ":" $2}')"

  log "case json-external-prd-worktree: $ws (prd $external_prd)"
  run_output="$(
    run_ralph "$ws" \
      --headless \
      --no-setup \
      --cwd "$ws" \
      --tracker json \
      --prd "$external_prd" \
      --worktree \
      --iterations 50 \
      2>&1
  )"
  printf '%s\n' "$run_output"

  after_cksum="$(cksum "$external_prd" | awk '{print $1 ":" $2}')"
  [[ "$before_cksum" == "$after_cksum" ]] || fail "external PRD was modified outside session worktree"

  worktree_path="$(printf '%s\n' "$run_output" | sed -n 's/^Worktree: //p' | head -n1)"
  rebased_prd_path="$(printf '%s\n' "$run_output" | sed -n 's/^JSON PRD rebased into worktree: //p' | head -n1)"
  [[ -n "$worktree_path" ]] || fail "missing worktree path log line"
  [[ -n "$rebased_prd_path" ]] || fail "missing external PRD rebasing log line"
  [[ "$rebased_prd_path" == "$worktree_path/"* ]] || fail "rebased PRD path escaped worktree root"
  [[ "$rebased_prd_path" == *'/.ralph-tui/external-prd/'* ]] || fail "rebased PRD path missing .ralph-tui/external-prd segment"

  assert_json_outputs_created "$ws"
  assert_worktree_cleaned "$ws"
  assert_session_lifecycle_cleaned "$ws"
  assert_iteration_logs_preserved "$ws"
}

main() {
  require_cmd bun
  require_cmd git
  require_cmd jq
  require_cmd br

  [[ -x "$MOCK_AGENT" ]] || fail "mock agent missing or not executable: $MOCK_AGENT"

  mkdir -p "$WORK_ROOT"

  should_run_case json-cli && run_case_json_cli
  should_run_case json-config && run_case_json_config
  should_run_case beads-cli && run_case_beads_cli
  should_run_case beads-config && run_case_beads_config
  should_run_case beads-resume && run_case_beads_resume
  should_run_case json-external-prd-worktree && run_case_json_external_prd_worktree

  log "PASS: all requested headless E2E cases succeeded"
}

main "$@"
