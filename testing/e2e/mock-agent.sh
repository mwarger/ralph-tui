#!/usr/bin/env bash
# ABOUTME: Deterministic mock agent for headless E2E tests.
# Emulates a Claude-compatible CLI command and always emits COMPLETE.

set -euo pipefail

for arg in "$@"; do
  if [[ "$arg" == "--version" ]]; then
    echo "claude 1.0.0"
    exit 0
  fi
done

prompt="$(cat || true)"

extract_task_id() {
  local data="$1"
  local id

  id="$(printf '%s\n' "$data" | sed -nE 's/^- \*\*ID\*\*: ([^[:space:]]+).*$/\1/p' | head -n1)"
  if [[ -n "$id" ]]; then
    printf '%s' "$id"
    return
  fi

  id="$(printf '%s\n' "$data" | sed -nE 's/^## Your Task: ([^[:space:]]+) - .*$/\1/p' | head -n1)"
  printf '%s' "$id"
}

extract_task_title() {
  local data="$1"
  local title

  title="$(printf '%s\n' "$data" | sed -nE 's/^- \*\*Title\*\*: (.*)$/\1/p' | head -n1)"
  if [[ -n "$title" ]]; then
    printf '%s' "$title"
    return
  fi

  title="$(printf '%s\n' "$data" | sed -nE 's/^## Your Task: [^[:space:]]+ - (.*)$/\1/p' | head -n1)"
  printf '%s' "$title"
}

task_id="$(extract_task_id "$prompt")"
task_title="$(extract_task_title "$prompt")"

mkdir -p .ralph-tui/e2e
printf '%s|%s\n' "${task_id:-unknown}" "${task_title:-unknown}" >> .ralph-tui/e2e/mock-agent.log

case "${task_id:-}" in
  TEST-001)
    printf 'Task A completed\n' > output-a.txt
    ;;
  TEST-002)
    printf 'Task B completed\n' > output-b.txt
    ;;
  TEST-003)
    printf 'Task C completed\n' > output-c.txt
    ;;
  TEST-004)
    {
      [[ -f output-a.txt ]] && cat output-a.txt
      [[ -f output-b.txt ]] && cat output-b.txt
    } > merged-ab.txt
    ;;
  TEST-005)
    {
      printf 'Completed tasks:\n'
      [[ -f output-a.txt ]] && printf '%s\n' '- TEST-001'
      [[ -f output-b.txt ]] && printf '%s\n' '- TEST-002'
      [[ -f output-c.txt ]] && printf '%s\n' '- TEST-003'
      [[ -f merged-ab.txt ]] && printf '%s\n' '- TEST-004'
      printf 'Summary complete.\n'
    } > summary.txt
    ;;
  *)
    case "${task_title:-}" in
      *"br-a.txt"*)
        printf 'beads task A\n' > br-a.txt
        ;;
      *"br-b.txt"*)
        printf 'beads task B\n' > br-b.txt
        ;;
      *"br-summary.txt"*)
        {
          printf 'beads summary\n'
          [[ -f br-a.txt ]] && printf '%s\n' '- br-a.txt'
          [[ -f br-b.txt ]] && printf '%s\n' '- br-b.txt'
        } > br-summary.txt
        ;;
    esac
    ;;
esac

echo '<promise>COMPLETE</promise>'
