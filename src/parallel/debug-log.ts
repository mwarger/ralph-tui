/**
 * ABOUTME: Debug logging utility for parallel execution diagnostics.
 * Writes detailed logs to help debug worktree/commit issues.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

let logFile: string | null = null;
let logEnabled = false;

/**
 * Initialize the debug log file in the project's cwd.
 * Call this once at the start of parallel execution.
 */
export function initDebugLog(projectCwd: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFile = path.join(projectCwd, `parallel-debug-${timestamp}.log`);
  logEnabled = true;

  const header = `
================================================================================
PARALLEL EXECUTION DEBUG LOG
Started: ${new Date().toISOString()}
Project CWD: ${projectCwd}
================================================================================

`;
  fs.writeFileSync(logFile, header);
  console.log(`[DEBUG] Parallel debug log: ${logFile}`);
}

/**
 * Write a debug log entry.
 */
export function debugLog(category: string, message: string, data?: Record<string, unknown>): void {
  if (!logEnabled || !logFile) return;

  const timestamp = new Date().toISOString();
  let entry = `[${timestamp}] [${category}] ${message}\n`;

  if (data) {
    entry += `  Data: ${JSON.stringify(data, null, 2).split('\n').join('\n  ')}\n`;
  }

  try {
    fs.appendFileSync(logFile, entry);
  } catch {
    // Silently fail if we can't write
  }
}

/**
 * Log git status for a directory.
 */
export function logGitStatus(category: string, cwd: string, context: string): void {
  if (!logEnabled) return;

  try {
    // Use execFileSync with argument arrays for security consistency
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', timeout: 5000 });
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

    debugLog(category, `Git status for ${context}`, {
      cwd,
      branch,
      head,
      status: status.trim() || '(clean)',
      filesInDir: listFiles(cwd),
    });
  } catch (err) {
    debugLog(category, `Git status FAILED for ${context}`, {
      cwd,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * List files in a directory (non-recursive, top-level only).
 */
function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith('.git'));
  } catch {
    return ['(error listing files)'];
  }
}

/**
 * Log worktree information.
 */
export function logWorktreeInfo(category: string, mainCwd: string): void {
  if (!logEnabled) return;

  try {
    // Use execFileSync with argument arrays for security consistency
    const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: mainCwd, encoding: 'utf-8', timeout: 5000 });
    debugLog(category, 'Worktree list', {
      mainCwd,
      worktrees: worktrees.trim().split('\n'),
    });
  } catch (err) {
    debugLog(category, 'Worktree list FAILED', {
      mainCwd,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Log branch commit count relative to HEAD.
 */
export function logBranchCommits(category: string, mainCwd: string, branchName: string): void {
  if (!logEnabled) return;

  try {
    // Use execFileSync with argument arrays to prevent command injection
    const count = execFileSync('git', ['rev-list', '--count', `HEAD..${branchName}`], {
      cwd: mainCwd,
      encoding: 'utf-8',
      timeout: 5000
    }).trim();

    const branchHead = execFileSync('git', ['rev-parse', '--short', branchName], {
      cwd: mainCwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const mainHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: mainCwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    debugLog(category, `Branch commit check: ${branchName}`, {
      mainCwd,
      branchName,
      commitsAhead: parseInt(count, 10),
      branchHead,
      mainHead,
      sameCommit: branchHead === mainHead,
    });
  } catch (err) {
    debugLog(category, `Branch commit check FAILED: ${branchName}`, {
      mainCwd,
      branchName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Close the debug log with a summary.
 */
export function closeDebugLog(): void {
  if (!logEnabled || !logFile) return;

  const footer = `
================================================================================
DEBUG LOG ENDED: ${new Date().toISOString()}
================================================================================
`;
  try {
    fs.appendFileSync(logFile, footer);
  } catch {
    // Silently fail
  }

  logEnabled = false;
}
