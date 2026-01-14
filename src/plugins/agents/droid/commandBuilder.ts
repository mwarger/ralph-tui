/**
 * ABOUTME: Builds Factory Droid CLI arguments for task execution.
 * Ensures non-interactive flags and working directory are applied.
 */

import { DROID_NON_INTERACTIVE_FLAGS } from './config.js';

export interface DroidCommandArgs {
  prompt: string;
  cwd: string;
  model?: string;
  reasoningEffort?: string;
}

export function buildDroidCommandArgs({
  prompt,
  cwd,
  model,
  reasoningEffort,
}: DroidCommandArgs): string[] {
  const args: string[] = [...DROID_NON_INTERACTIVE_FLAGS];

  if (model) {
    args.push('--model', model);
  }

  if (reasoningEffort) {
    args.push('--reasoning-effort', reasoningEffort);
  }

  args.push(prompt, '--cwd', cwd);
  return args;
}
