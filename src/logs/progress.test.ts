/**
 * ABOUTME: Tests for progress file management and notes extraction.
 * Verifies that completion notes are extracted correctly and tool output
 * (like Read tool line numbers) is properly filtered out.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createProgressEntry,
  appendProgress,
  readProgress,
  getRecentProgressSummary,
  clearProgress,
  extractCodebasePatterns,
  PROGRESS_FILE,
} from './progress.js';
import type { IterationResult } from '../engine/types.js';

/**
 * Helper to create a minimal IterationResult for testing.
 */
function makeIterationResult(
  overrides: Partial<IterationResult> & { stdout?: string }
): IterationResult {
  return {
    iteration: 1,
    task: { id: 'test-1', title: 'Test Task', status: 'open', priority: 2 },
    taskCompleted: true,
    agentResult: {
      exitCode: 0,
      stdout: overrides.stdout ?? '',
      stderr: '',
      durationMs: 100,
    },
    durationMs: 100,
    ...overrides,
  } as IterationResult;
}

describe('progress.ts', () => {
  describe('createProgressEntry - notes extraction', () => {
    test('extracts notes before <promise>COMPLETE</promise>', () => {
      const result = makeIterationResult({
        stdout: `
I'll help you with that task.

Here's what I did:
- Fixed the bug in auth.ts
- Updated the tests

All done!
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      expect(entry.notes).toContain('Fixed the bug');
      expect(entry.notes).toContain('Updated the tests');
    });

    test('returns undefined when no completion marker', () => {
      const result = makeIterationResult({
        stdout: 'Some output without completion marker',
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeUndefined();
    });

    test('filters out Read tool line numbers from notes', () => {
      const result = makeIterationResult({
        stdout: `
Let me check the file.
00045|     export function foo() {
00046|       return bar;
00047|     }
00048|

I found the function and updated it.
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      // Should NOT contain line number prefixes
      expect(entry.notes).not.toMatch(/\d{5}\|/);
      // Should contain the meaningful text
      expect(entry.notes).toContain('found the function');
    });

    test('filters out Read tool line numbers with various formats', () => {
      const result = makeIterationResult({
        stdout: `
Reading the file...
   123|   const x = 1;
  1234|   const y = 2;
 12345|   const z = 3;

Done reading.
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      // Should NOT contain any line number formats
      expect(entry.notes).not.toMatch(/\s*\d{3,6}\|/);
      expect(entry.notes).toContain('Done reading');
    });

    test('filters out XML-like tool markers', () => {
      const result = makeIterationResult({
        stdout: `
<file>
content here
</file>
<function_results>
some results
</function_results>
<system-reminder>
reminder text
</system-reminder>

Task completed successfully.
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      // Should NOT contain XML markers
      expect(entry.notes).not.toContain('<file>');
      expect(entry.notes).not.toContain('</file>');
      expect(entry.notes).not.toContain('<function_results>');
      expect(entry.notes).not.toContain('<system-reminder>');
      // Should contain meaningful content
      expect(entry.notes).toContain('Task completed successfully');
    });

    test('filters out closing XML tags', () => {
      const result = makeIterationResult({
        stdout: `
</output>
</result>
</thinking>

The task is done.
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      expect(entry.notes).not.toContain('</output>');
      expect(entry.notes).not.toContain('</result>');
      expect(entry.notes).toContain('task is done');
    });

    test('filters out code artifact lines (punctuation only)', () => {
      const result = makeIterationResult({
        stdout: `
}
});
];
|

Implementation complete.
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      // Should NOT contain bare punctuation lines
      expect(entry.notes).not.toMatch(/^[}\]);|]+$/m);
      expect(entry.notes).toContain('Implementation complete');
    });

    test('handles mixed content with tool output and real notes', () => {
      const result = makeIterationResult({
        stdout: `
Let me read the file first.

00001|     /**
00002|      * ABOUTME: Some file
00003|      */
00004|
00005|     export function test() {
00006|       return true;
00007|     }

<system-reminder>
This is a system reminder.
</system-reminder>

I've analyzed the code. The function needs refactoring.
Here's what I changed:
- Simplified the logic
- Added error handling

<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      // Should contain the meaningful notes
      expect(entry.notes).toContain('analyzed the code');
      expect(entry.notes).toContain('Simplified the logic');
      // Should NOT contain tool output
      expect(entry.notes).not.toMatch(/\d{5}\|/);
      expect(entry.notes).not.toContain('<system-reminder>');
    });

    test('returns undefined when only tool output before completion', () => {
      const result = makeIterationResult({
        stdout: `
00001|     line 1
00002|     line 2
00003|     line 3
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      // All content is filtered out, so notes should be undefined
      expect(entry.notes).toBeUndefined();
    });

    test('handles case-insensitive completion marker', () => {
      const result = makeIterationResult({
        stdout: `
Task done.
<PROMISE>complete</PROMISE>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      expect(entry.notes).toContain('Task done');
    });

    test('extracts at most 5 lines of notes', () => {
      const result = makeIterationResult({
        stdout: `
Line 1
Line 2
Line 3
Line 4
Line 5
Line 6
Line 7
<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.notes).toBeDefined();
      const lines = entry.notes!.split('\n').filter((l) => l.trim());
      expect(lines.length).toBeLessThanOrEqual(5);
      // Should have the LAST 5 lines
      expect(entry.notes).toContain('Line 7');
      expect(entry.notes).toContain('Line 3');
    });
  });

  describe('createProgressEntry - insights extraction', () => {
    test('extracts insight blocks from output', () => {
      const result = makeIterationResult({
        stdout: `
\`★ Insight ─────────────────────────────────────\`
This is an insight about the code.
It spans multiple lines.
\`─────────────────────────────────────────────────\`

<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.insights).toBeDefined();
      expect(entry.insights!.length).toBe(1);
      expect(entry.insights![0]).toContain('insight about the code');
    });

    test('extracts multiple insight blocks', () => {
      const result = makeIterationResult({
        stdout: `
\`★ Insight ─────────────────────────────────────\`
First insight here.
\`─────────────────────────────────────────────────\`

Some other content.

\`★ Insight ─────────────────────────────────────\`
Second insight here.
\`─────────────────────────────────────────────────\`

<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.insights).toBeDefined();
      expect(entry.insights!.length).toBe(2);
    });

    test('ignores very short insights (< 10 chars)', () => {
      const result = makeIterationResult({
        stdout: `
\`★ Insight ─────────────────────────────────────\`
Short
\`─────────────────────────────────────────────────\`

<promise>COMPLETE</promise>
`,
      });

      const entry = createProgressEntry(result);

      expect(entry.insights).toEqual([]);
    });
  });

  describe('createProgressEntry - basic fields', () => {
    test('populates all required fields', () => {
      const result = makeIterationResult({
        iteration: 5,
        task: { id: 'task-42', title: 'Fix the bug', status: 'in_progress', priority: 1 },
        taskCompleted: true,
        durationMs: 5000,
        error: undefined,
        stdout: '<promise>COMPLETE</promise>',
      });

      const entry = createProgressEntry(result);

      expect(entry.iteration).toBe(5);
      expect(entry.taskId).toBe('task-42');
      expect(entry.taskTitle).toBe('Fix the bug');
      expect(entry.completed).toBe(true);
      expect(entry.durationMs).toBe(5000);
      expect(entry.timestamp).toBeDefined();
      expect(entry.error).toBeUndefined();
    });

    test('captures error when task fails', () => {
      const result = makeIterationResult({
        taskCompleted: false,
        error: 'Build failed with exit code 1',
        stdout: '',
      });

      const entry = createProgressEntry(result);

      expect(entry.completed).toBe(false);
      expect(entry.error).toBe('Build failed with exit code 1');
    });
  });

  describe('file operations', () => {
    const testDir = '/tmp/progress-test-' + Date.now();

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test('appendProgress creates file with header if missing', async () => {
      const entry = createProgressEntry(
        makeIterationResult({ stdout: 'Done\n<promise>COMPLETE</promise>' })
      );

      await appendProgress(testDir, entry);

      const content = await readFile(join(testDir, PROGRESS_FILE), 'utf-8');
      expect(content).toContain('# Ralph Progress Log');
      expect(content).toContain('## ✓ Iteration 1');
    });

    test('appendProgress appends to existing file', async () => {
      const entry1 = createProgressEntry(
        makeIterationResult({
          iteration: 1,
          stdout: 'First\n<promise>COMPLETE</promise>',
        })
      );
      const entry2 = createProgressEntry(
        makeIterationResult({
          iteration: 2,
          stdout: 'Second\n<promise>COMPLETE</promise>',
        })
      );

      await appendProgress(testDir, entry1);
      await appendProgress(testDir, entry2);

      const content = await readFile(join(testDir, PROGRESS_FILE), 'utf-8');
      expect(content).toContain('## ✓ Iteration 1');
      expect(content).toContain('## ✓ Iteration 2');
    });

    test('readProgress returns empty string for missing file', async () => {
      const content = await readProgress(testDir);
      expect(content).toBe('');
    });

    test('readProgress returns file content', async () => {
      const testContent = '# Test Progress\n\nSome content here.';
      await mkdir(join(testDir, '.ralph-tui'), { recursive: true });
      await writeFile(join(testDir, PROGRESS_FILE), testContent);

      const content = await readProgress(testDir);
      expect(content).toBe(testContent);
    });

    test('clearProgress resets file to default header', async () => {
      const entry = createProgressEntry(
        makeIterationResult({ stdout: 'Done\n<promise>COMPLETE</promise>' })
      );
      await appendProgress(testDir, entry);

      await clearProgress(testDir);

      const content = await readProgress(testDir);
      expect(content).toContain('# Ralph Progress Log');
      expect(content).toContain('## Codebase Patterns');
      expect(content).not.toContain('## ✓ Iteration');
    });

    test('getRecentProgressSummary returns last N entries', async () => {
      for (let i = 1; i <= 10; i++) {
        const entry = createProgressEntry(
          makeIterationResult({
            iteration: i,
            stdout: `Task ${i}\n<promise>COMPLETE</promise>`,
          })
        );
        await appendProgress(testDir, entry);
      }

      const summary = await getRecentProgressSummary(testDir, 3);

      expect(summary).toContain('Iteration 8');
      expect(summary).toContain('Iteration 9');
      expect(summary).toContain('Iteration 10');
      expect(summary).not.toContain('Iteration 7');
    });

    test('extractCodebasePatterns returns empty for default header', async () => {
      await clearProgress(testDir);

      const patterns = await extractCodebasePatterns(testDir);
      expect(patterns).toEqual([]);
    });

    test('extractCodebasePatterns extracts bullet points', async () => {
      const content = `# Ralph Progress Log

## Codebase Patterns (Study These First)

- Always use async/await for file operations
- Follow the ABOUTME comment convention
- Test files go alongside source files

---

## ✓ Iteration 1
`;
      await mkdir(join(testDir, '.ralph-tui'), { recursive: true });
      await writeFile(join(testDir, PROGRESS_FILE), content);

      const patterns = await extractCodebasePatterns(testDir);

      expect(patterns).toContain('Always use async/await for file operations');
      expect(patterns).toContain('Follow the ABOUTME comment convention');
      expect(patterns).toContain('Test files go alongside source files');
    });
  });
});
